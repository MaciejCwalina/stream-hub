// stream-hub: real-time metric hub for the home LLM server.
//
// Samplers (continuous metrics):
//   - vLLM /metrics polled every 200ms (throughput, scheduler state, KV cache, spec-decode acceptance)
//   - nvidia-smi polled every 500ms (per-card temp, memory clock, power, utilization)
//
// Push endpoint (event metrics):
//   - POST /push  {"metric":"vram_oc.xid_errors","value":1}  (used by vram-oc-guard)
//
// Fan-out:
//   - WS /stream?metrics=prefix1,prefix2 — on connect the client receives a snapshot
//     (recent history for the requested prefixes), then update batches (~100ms cadence).
//
// Message format: {"type":"snapshot|update","data":[[metric, unix_ms, value], ...]}
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const historyCap = 20000 // ~20 min at current rates; enough for a useful snapshot window

type entry struct {
	metric string
	ts     time.Time
	value  float64
}

type subscriber struct {
	ch       chan []entry
	prefixes []string
}

type Hub struct {
	mu      sync.Mutex
	latest  map[string]float64
	hist    []entry
	pending []entry // entries not yet broadcast

	subsMu sync.Mutex
	subs   map[*subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{
		latest: map[string]float64{},
		subs:   map[*subscriber]struct{}{},
	}
}

func (h *Hub) record(metric string, value float64) {
	now := time.Now()
	h.mu.Lock()
	h.latest[metric] = value
	h.hist = append(h.hist, entry{metric, now, value})
	if len(h.hist) > historyCap {
		h.hist = h.hist[len(h.hist)-historyCap:]
	}
	h.pending = append(h.pending, entry{metric, now, value})
	h.mu.Unlock()
}

// Broadcaster flushes pending entries to all subscribers every interval,
// filtered per subscriber by their metric prefixes.
func (h *Hub) Broadcaster(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.mu.Lock()
			batch := h.pending
			h.pending = nil
			h.mu.Unlock()
			if len(batch) == 0 {
				continue
			}
			h.subsMu.Lock()
			for sub := range h.subs {
				filtered := batch
				if len(sub.prefixes) > 0 {
					filtered = nil
					for _, item := range batch {
						if matchesAny(item.metric, sub.prefixes) {
							filtered = append(filtered, item)
						}
					}
				}
				if len(filtered) == 0 {
					continue
				}
				select {
				case sub.ch <- filtered:
				default: // slow client: drop the batch rather than block
				}
			}
			h.subsMu.Unlock()
		}
	}
}

func (h *Hub) subscribe(prefixes []string) *subscriber {
	sub := &subscriber{ch: make(chan []entry, 16), prefixes: prefixes}
	h.subsMu.Lock()
	h.subs[sub] = struct{}{}
	h.subsMu.Unlock()
	return sub
}

func (h *Hub) unsubscribe(sub *subscriber) {
	h.subsMu.Lock()
	delete(h.subs, sub)
	close(sub.ch)
	h.subsMu.Unlock()
}

func (h *Hub) snapshot(prefixes []string) []entry {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []entry
	for _, item := range h.hist {
		if matchesAny(item.metric, prefixes) {
			out = append(out, item)
		}
	}
	if len(out) > 5000 {
		out = out[len(out)-5000:]
	}
	return out
}

func matchesAny(metric string, prefixes []string) bool {
	if len(prefixes) == 0 {
		return true
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(metric, prefix) {
			return true
		}
	}
	return false
}

func encodeBatch(typ string, data []entry) ([]byte, error) {
	rows := make([][]any, 0, len(data))
	for _, item := range data {
		rows = append(rows, []any{item.metric, item.ts.UnixMilli(), item.value})
	}
	return json.Marshal(map[string]any{"type": typ, "data": rows})
}

var upgrader = websocket.Upgrader{}

func (h *Hub) handleStream(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws accept: %v", err)
		return
	}
	defer conn.Close()

	var prefixes []string
	if query := r.URL.Query().Get("metrics"); query != "" {
		for _, part := range strings.Split(query, ",") {
			if part = strings.TrimSpace(part); part != "" {
				prefixes = append(prefixes, part)
			}
		}
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sub := h.subscribe(prefixes)
	defer h.unsubscribe(sub)
	// Snapshot first.
	snap, err := encodeBatch("snapshot", h.snapshot(prefixes))
	if err == nil {
		if err := conn.WriteMessage(websocket.TextMessage, snap); err != nil {
			return
		}
	}

	// Then updates.
	for {
		select {
		case <-ctx.Done():
			return
		case batch := <-sub.ch:
			msg, err := encodeBatch("update", batch)
			if err != nil {
				continue
			}
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}
}

type pushMsg struct {
	Metric string  `json:"metric"`
	Value  float64 `json:"value"`
}

func (h *Hub) handlePush(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var msgs []pushMsg
	if err := json.Unmarshal(body, &msgs); err != nil {
		var single pushMsg
		if err := json.Unmarshal(body, &single); err != nil {
			http.Error(w, "bad json: expected {metric,value} or [{metric,value},...]", http.StatusBadRequest)
			return
		}
		msgs = []pushMsg{single}
	}
	for _, message := range msgs {
		if message.Metric == "" {
			continue
		}
		h.record(message.Metric, message.Value)
	}
	w.WriteHeader(http.StatusOK)
}

// --- vLLM sampler -----------------------------------------------------------

type vllmState struct {
	genTokens, promptTokens, accepted, drafts float64
	last                                      time.Time
	primed                                    bool // first scrape only primes counters (avoids a rate spike)
}

// vllmSum sums all sample values for one metric name in Prometheus text exposition format.
func vllmSum(text, name string) (float64, bool) {
	total, found := 0.0, false
	for _, line := range strings.Split(text, "\n") {
		rest := strings.TrimPrefix(line, name)
		if rest == line || len(rest) == 0 || (rest[0] != '{' && rest[0] != ' ') {
			continue // not this metric (guards against prefix collisions)
		}
		idx := strings.LastIndex(line, " ")
		if idx < 0 {
			continue
		}
		value, err := strconv.ParseFloat(line[idx+1:], 64)
		if err != nil {
			continue
		}
		total += value
		found = true
	}
	return total, found
}

func (h *Hub) sampleVLLM(url string, interval time.Duration) {
	st := &vllmState{last: time.Now()}
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for {
		time.Sleep(interval)
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		text, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}

		running, hasRunning := vllmSum(string(text), "vllm:num_requests_running")
		waiting, _ := vllmSum(string(text), "vllm:num_requests_waiting")
		kv, _ := vllmSum(string(text), "vllm:kv_cache_usage_perc")
		gen, _ := vllmSum(string(text), "vllm:generation_tokens_total")
		prompt, _ := vllmSum(string(text), "vllm:prompt_tokens_total")
		acc, _ := vllmSum(string(text), "vllm:spec_decode_num_accepted_tokens_total")
		drafts, _ := vllmSum(string(text), "vllm:spec_decode_num_drafts_total")

		now := time.Now()
		first := !st.primed
		st.primed = true
		dt := now.Sub(st.last).Seconds()
		st.last = now
		if dt <= 0 {
			continue
		}
		if gen > st.genTokens && !first {
			h.record("vllm.tok_s", (gen-st.genTokens)/dt)
		}
		st.genTokens = gen
		if prompt > st.promptTokens && !first {
			h.record("vllm.prompt_tok_s", (prompt-st.promptTokens)/dt)
		}
		st.promptTokens = prompt
		if drafts > st.drafts && drafts > 0 {
			h.record("vllm.spec_accept", (acc-st.accepted)/(drafts-st.drafts))
			st.accepted, st.drafts = acc, drafts
		}
		if hasRunning {
			h.record("vllm.running", running)
		}
		if waiting > 0 {
			h.record("vllm.waiting", waiting)
		}
		if kv > 0 {
			h.record("vllm.kv_usage", kv)
		}
	}
}

// --- GPU sampler ------------------------------------------------------------

var sanitizeRe = regexp.MustCompile(`[^a-z0-9]+`)

// gpuNames maps nvidia-smi UUIDs to friendly card names from the textfile
// collector (gpu_card_info{uuid="...",card="GPU0 ASUS Dual"}).
func loadGPUNames() map[string]string {
	names := map[string]string{}
	data, err := os.ReadFile("/var/lib/node_exporter/textfile/gpu_cards.prom")
	if err != nil {
		return names
	}
	re := regexp.MustCompile(`gpu_card_info\{uuid="([^"]+)",card="([^"]+)"\}`)
	for _, match := range re.FindAllSubmatch(data, -1) {
		names[string(match[1])] = strings.ToLower(strings.TrimSpace(string(match[2])))
	}
	return names
}

func (h *Hub) sampleGPU(interval time.Duration) {
	names := loadGPUNames()
	for {
		time.Sleep(interval)
		out, err := exec.Command("nvidia-smi",
			"--query-gpu=uuid,name,temperature.gpu,clocks.current.memory,power.draw,utilization.gpu",
			"--format=csv,noheader,nounits").Output()
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		for index, line := range lines {
			fields := strings.Split(line, ",")
			if len(fields) < 6 {
				continue
			}
			uuid := strings.ToLower(strings.TrimSpace(fields[0]))
			uuid = strings.TrimPrefix(uuid, "gpu-")
			card := fmt.Sprintf("gpu%d", index)
			if friendly, ok := names[uuid]; ok {
				card = sanitizeRe.ReplaceAllString(friendly, "_")
			} else {
				card += "_" + sanitizeRe.ReplaceAllString(strings.ToLower(fields[1]), "_")
			}
			values := []float64{}
			for _, field := range fields[2:] {
				value, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
				if err != nil {
					values = nil
					break
				}
				values = append(values, value)
			}
			if len(values) != 4 {
				continue
			}
			h.record(card+".temp_c", values[0])
			h.record(card+".mem_clock_mhz", values[1]/1000.0) // nvidia-smi reports kHz
			h.record(card+".power_w", values[2])
			h.record(card+".util_pct", values[3])
		}
	}
}

func main() {
	listen := flag.String("listen", "127.0.0.1:9797", "address to listen on")
	vllmURL := flag.String("vllm", "http://localhost:8000/metrics", "vLLM metrics URL")
	vllmInterval := flag.Duration("vllm-interval", 200*time.Millisecond, "vLLM scrape interval")
	gpuInterval := flag.Duration("gpu-interval", 500*time.Millisecond, "nvidia-smi interval")
	flag.Parse()

	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Broadcaster(ctx, 100*time.Millisecond)
	go hub.sampleVLLM(*vllmURL, *vllmInterval)
	go hub.sampleGPU(*gpuInterval)

	mux := http.NewServeMux()
	mux.HandleFunc("/stream", hub.handleStream)
	mux.HandleFunc("/push", hub.handlePush)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "ok") })

	log.Printf("stream-hub listening on %s (vllm=%s every %s, gpu every %s)", *listen, *vllmURL, *vllmInterval, *gpuInterval)
	log.Fatal(http.ListenAndServe(*listen, mux))
}

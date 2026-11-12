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
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"home-llm-server/stream-hub/samplers"
)

const historyCap = 20000 // ~20 min at current rates; enough for a useful snapshot window

type entry struct {
	metric    string
	timestamp time.Time
	value     float64
}

type subscriber struct {
	ch           chan []entry
	promPrefixes []string
}

type MetricHub struct {
	mu               sync.Mutex
	lastValues       map[string]float64 // most recent value per metric
	history          []entry            // rolling sample history (capped), used for connect snapshots
	pendingBroadcast []entry            // samples waiting to be flushed to subscribers

	subscribersMutex sync.Mutex
	subscribers      map[*subscriber]struct{}
}

func NewMetricHub() *MetricHub {
	return &MetricHub{
		lastValues:  map[string]float64{},
		subscribers: map[*subscriber]struct{}{},
	}
}

func (h *MetricHub) record(metric string, value float64) {
	now := time.Now()
	h.mu.Lock()
	h.lastValues[metric] = value
	h.history = append(h.history, entry{metric, now, value})
	if len(h.history) > historyCap {
		h.history = h.history[len(h.history)-historyCap:]
	}

	h.pendingBroadcast = append(h.pendingBroadcast, entry{metric, now, value})
	h.mu.Unlock()
}

// Broadcaster flushes pending entries to all subscribers every interval,
// filtered per subscriber by their metric prefixes.
func (h *MetricHub) Broadcaster(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.mu.Lock()
			batch := h.pendingBroadcast
			h.pendingBroadcast = nil
			h.mu.Unlock()
			if len(batch) == 0 {
				continue
			}

			h.subscribersMutex.Lock()
			for sub := range h.subscribers {
				filtered := batch
				if len(sub.promPrefixes) > 0 {
					filtered = nil
					for _, item := range batch {
						if matchesAny(item.metric, sub.promPrefixes) {
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

			h.subscribersMutex.Unlock()
		}
	}
}

func (h *MetricHub) subscribe(promPrefixes []string) *subscriber {
	sub := &subscriber{ch: make(chan []entry, 16), promPrefixes: promPrefixes}
	h.subscribersMutex.Lock()
	h.subscribers[sub] = struct{}{}
	h.subscribersMutex.Unlock()
	return sub
}

func (h *MetricHub) unsubscribe(sub *subscriber) {
	h.subscribersMutex.Lock()
	delete(h.subscribers, sub)
	close(sub.ch)
	h.subscribersMutex.Unlock()
}

func (h *MetricHub) snapshot(promPrefixes []string) []entry {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []entry
	for _, item := range h.history {
		if matchesAny(item.metric, promPrefixes) {
			out = append(out, item)
		}
	}

	if len(out) > 5000 {
		out = out[len(out)-5000:]
	}

	return out
}

func matchesAny(metric string, promPrefixes []string) bool {
	if len(promPrefixes) == 0 {
		return true
	}

	for _, prefix := range promPrefixes {
		if strings.HasPrefix(metric, prefix) {
			return true
		}
	}
	return false
}

func encodeBatch(typ string, data []entry) ([]byte, error) {
	rows := make([][]any, 0, len(data))
	for _, item := range data {
		rows = append(rows, []any{item.metric, item.timestamp.UnixMilli(), item.value})
	}

	return json.Marshal(map[string]any{"type": typ, "data": rows})
}

var upgrader = websocket.Upgrader{}

func (h *MetricHub) handleStream(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws accept: %v", err)
		return
	}

	defer conn.Close()

	var promPrefixes []string
	if query := r.URL.Query().Get("metrics"); query != "" {
		for _, part := range strings.Split(query, ",") {
			if part = strings.TrimSpace(part); part != "" {
				promPrefixes = append(promPrefixes, part)
			}
		}
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sub := h.subscribe(promPrefixes)
	defer h.unsubscribe(sub)
	// Snapshot first.
	snap, err := encodeBatch("snapshot", h.snapshot(promPrefixes))
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

func (h *MetricHub) handlePush(w http.ResponseWriter, r *http.Request) {
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

func main() {
	listen := flag.String("listen", "127.0.0.1:9797", "address to listen on")
	vllmURL := flag.String("vllm", "http://localhost:8000/metrics", "vLLM metrics URL")
	vllmInterval := flag.Duration("vllm-interval", 200*time.Millisecond, "vLLM scrape interval")
	gpuInterval := flag.Duration("gpu-interval", 500*time.Millisecond, "nvidia-smi interval")
	flag.Parse()

	metricHub := NewMetricHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go metricHub.Broadcaster(ctx, 100*time.Millisecond)
	go samplers.VLLM(metricHub.record, *vllmURL, *vllmInterval)
	go samplers.GPU(metricHub.record, *gpuInterval)

	mux := http.NewServeMux()
	mux.HandleFunc("/stream", metricHub.handleStream)
	mux.HandleFunc("/push", metricHub.handlePush)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "ok") })

	log.Printf("stream-hub listening on %s (vllm=%s every %s, gpu every %s)", *listen, *vllmURL, *vllmInterval, *gpuInterval)
	log.Fatal(http.ListenAndServe(*listen, mux))
}

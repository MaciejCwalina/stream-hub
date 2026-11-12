// stream-hub: real-time metric hub for the home LLM server.
//
// Samplers (continuous metrics):
//   - vLLM /metrics polled every 200ms (throughput, scheduler state, KV cache, spec-decode acceptance)
//   - nvidia-smi polled every 500ms (per-card temp, memory clock, power, utilization)
//
// Push endpoint (event metrics):
//   - POST /push  {"metric":"vram_oc.xid_errors","value":1}  (used by vram-oc-guard)
//
// Self-observability:
//   - GET /metrics — Prometheus text format: sampler failures/last success,
//     fan-out stats (subscribers, batches, drops), internal state sizes.
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

// hubStats tracks the hub's own observability data, exposed at /metrics.
type hubStats struct {
	mu sync.Mutex

	samplesTotal          uint64
	pushRequestsTotal     uint64
	broadcastBatchesTotal uint64
	droppedBatchesTotal   uint64
	wsConnectionsTotal    uint64

	samplerFailures    map[string]uint64
	samplerLastSuccess map[string]time.Time
}

func newHubStats() *hubStats {
	return &hubStats{
		samplerFailures:    map[string]uint64{},
		samplerLastSuccess: map[string]time.Time{},
	}
}

func (st *hubStats) addSamples(count int) {
	st.mu.Lock()
	st.samplesTotal += uint64(count)
	st.mu.Unlock()
}

func (st *hubStats) incPush() {
	st.mu.Lock()
	st.pushRequestsTotal++
	st.mu.Unlock()
}

func (st *hubStats) incBroadcast() {
	st.mu.Lock()
	st.broadcastBatchesTotal++
	st.mu.Unlock()
}

func (st *hubStats) incDropped() {
	st.mu.Lock()
	st.droppedBatchesTotal++
	st.mu.Unlock()
}

func (st *hubStats) incConnection() {
	st.mu.Lock()
	st.wsConnectionsTotal++
	st.mu.Unlock()
}

func (st *hubStats) noteSamplerResult(source string, ok bool) {
	st.mu.Lock()
	if ok {
		st.samplerLastSuccess[source] = time.Now()
	} else {
		st.samplerFailures[source]++
	}

	st.mu.Unlock()
}

// metricsText renders the hub's self-metrics in Prometheus text format.
func (st *hubStats) metricsText(subscriberCount int, trackedCount int, historyCount int) string {
	st.mu.Lock()
	defer st.mu.Unlock()

	var buf strings.Builder
	fmt.Fprintf(&buf, "# HELP stream_hub_samples_total Total metric samples recorded by the hub.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_samples_total counter\n")
	fmt.Fprintf(&buf, "stream_hub_samples_total %d\n", st.samplesTotal)

	fmt.Fprintf(&buf, "# HELP stream_hub_push_requests_total Total POST /push requests handled.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_push_requests_total counter\n")
	fmt.Fprintf(&buf, "stream_hub_push_requests_total %d\n", st.pushRequestsTotal)

	fmt.Fprintf(&buf, "# HELP stream_hub_broadcast_batches_total Total update batches flushed to subscribers.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_broadcast_batches_total counter\n")
	fmt.Fprintf(&buf, "stream_hub_broadcast_batches_total %d\n", st.broadcastBatchesTotal)

	fmt.Fprintf(&buf, "# HELP stream_hub_dropped_batches_total Total batches dropped because a subscriber was too slow.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_dropped_batches_total counter\n")
	fmt.Fprintf(&buf, "stream_hub_dropped_batches_total %d\n", st.droppedBatchesTotal)

	fmt.Fprintf(&buf, "# HELP stream_hub_ws_connections_total Total WebSocket connections accepted.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_ws_connections_total counter\n")
	fmt.Fprintf(&buf, "stream_hub_ws_connections_total %d\n", st.wsConnectionsTotal)

	fmt.Fprintf(&buf, "# HELP stream_hub_subscribers Currently connected WebSocket subscribers.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_subscribers gauge\n")
	fmt.Fprintf(&buf, "stream_hub_subscribers %d\n", subscriberCount)

	fmt.Fprintf(&buf, "# HELP stream_hub_tracked_metrics Distinct metrics currently held.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_tracked_metrics gauge\n")
	fmt.Fprintf(&buf, "stream_hub_tracked_metrics %d\n", trackedCount)

	fmt.Fprintf(&buf, "# HELP stream_hub_history_entries Samples kept in the rolling history buffer.\n")
	fmt.Fprintf(&buf, "# TYPE stream_hub_history_entries gauge\n")
	fmt.Fprintf(&buf, "stream_hub_history_entries %d\n", historyCount)

	for _, source := range []string{"vllm", "gpu"} {
		fmt.Fprintf(&buf, "# HELP stream_hub_sampler_failures_total Failed scrape attempts per sampler.\n")
		fmt.Fprintf(&buf, "# TYPE stream_hub_sampler_failures_total counter\n")
		fmt.Fprintf(&buf, "stream_hub_sampler_failures_total{source=%q} %d\n", source, st.samplerFailures[source])

		lastSuccess := 0.0
		if sampleTime, ok := st.samplerLastSuccess[source]; ok {
			lastSuccess = float64(sampleTime.Unix())
		}

		fmt.Fprintf(&buf, "# HELP stream_hub_sampler_last_success_seconds Unix time of the last successful scrape.\n")
		fmt.Fprintf(&buf, "# TYPE stream_hub_sampler_last_success_seconds gauge\n")
		fmt.Fprintf(&buf, "stream_hub_sampler_last_success_seconds{source=%q} %d\n", source, int64(lastSuccess))
	}

	return buf.String()
}

type MetricHub struct {
	mu               sync.Mutex
	lastValues       map[string]float64 // most recent value per metric
	history          []entry            // rolling sample history (capped), used for connect snapshots
	pendingBroadcast []entry            // samples waiting to be flushed to subscribers

	subscribersMutex sync.Mutex
	subscribers      map[*subscriber]struct{}

	stats *hubStats
}

func NewMetricHub() *MetricHub {
	return &MetricHub{
		lastValues:  map[string]float64{},
		subscribers: map[*subscriber]struct{}{},
		stats:       newHubStats(),
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
	h.stats.addSamples(1)
}

func (h *MetricHub) noteVLLMSample(ok bool) {
	h.stats.noteSamplerResult("vllm", ok)
}

func (h *MetricHub) noteGPUSample(ok bool) {
	h.stats.noteSamplerResult("gpu", ok)
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
					h.stats.incDropped()
				}
			}

			h.subscribersMutex.Unlock()
			h.stats.incBroadcast()
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

func (h *MetricHub) snapshot(promPrefixes []string, window time.Duration) []entry {
	h.mu.Lock()
	defer h.mu.Unlock()
	cutoff := time.Now().Add(-window)
	var out []entry
	for _, item := range h.history {
		if item.timestamp.Before(cutoff) {
			continue
		}

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

	h.stats.incConnection()
	defer conn.Close()

	var promPrefixes []string
	if query := r.URL.Query().Get("metrics"); query != "" {
		for _, part := range strings.Split(query, ",") {
			if part = strings.TrimSpace(part); part != "" {
				promPrefixes = append(promPrefixes, part)
			}
		}
	}

	window := 60 * time.Second
	if rawWindow := r.URL.Query().Get("window"); rawWindow != "" {
		if parsed, parseErr := time.ParseDuration(rawWindow); parseErr == nil && parsed > 0 {
			window = parsed
		}
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sub := h.subscribe(promPrefixes)
	defer h.unsubscribe(sub)
	// Snapshot first.
	snap, err := encodeBatch("snapshot", h.snapshot(promPrefixes, window))
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
	h.stats.incPush()
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

func (h *MetricHub) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	h.subscribersMutex.Lock()
	subscriberCount := len(h.subscribers)
	h.subscribersMutex.Unlock()

	h.mu.Lock()
	trackedCount := len(h.lastValues)
	historyCount := len(h.history)
	h.mu.Unlock()

	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprint(w, h.stats.metricsText(subscriberCount, trackedCount, historyCount))
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
	go samplers.VLLM(metricHub.record, metricHub.noteVLLMSample, *vllmURL, *vllmInterval)
	go samplers.GPU(metricHub.record, metricHub.noteGPUSample, *gpuInterval)

	mux := http.NewServeMux()
	mux.HandleFunc("/stream", metricHub.handleStream)
	mux.HandleFunc("/push", metricHub.handlePush)
	mux.HandleFunc("/metrics", metricHub.handleMetrics)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "ok") })

	log.Printf("stream-hub listening on %s (vllm=%s every %s, gpu every %s)", *listen, *vllmURL, *vllmInterval, *gpuInterval)
	log.Fatal(http.ListenAndServe(*listen, mux))
}

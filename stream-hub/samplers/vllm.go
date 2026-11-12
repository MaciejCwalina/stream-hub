package samplers

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type vllmState struct {
	genTokens, promptTokens, accepted, drafts float64
	last                                      time.Time
	primed                                    bool // first scrape only primes counters (avoids a rate spike)
}

// vllmSum sums all sample values for one metric name in Prometheus text exposition format.
func vllmSum(text string, name string) (float64, bool) {
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

// VLLM polls the vLLM metrics endpoint and records derived metrics.
func VLLM(recorder Recorder, url string, interval time.Duration) {
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
			recorder("vllm.tok_s", (gen-st.genTokens)/dt)
		}

		st.genTokens = gen
		if prompt > st.promptTokens && !first {
			recorder("vllm.prompt_tok_s", (prompt-st.promptTokens)/dt)
		}

		st.promptTokens = prompt
		if drafts > st.drafts && drafts > 0 {
			recorder("vllm.spec_accept", (acc-st.accepted)/(drafts-st.drafts))
			st.accepted, st.drafts = acc, drafts
		}

		if hasRunning {
			recorder("vllm.running", running)
		}

		if waiting > 0 {
			recorder("vllm.waiting", waiting)
		}

		if kv > 0 {
			recorder("vllm.kv_usage", kv)
		}
	}
}

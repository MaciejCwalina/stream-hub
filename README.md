# stream-hub

Push-based live metrics for a vLLM + GPU box: a small Go hub that samples/pushes metrics and fans them out over WebSocket, plus a Grafana datasource plugin that streams them straight into panels — no polling, updates land the instant they happen.

Built for the home LLM server (4× RTX 5060 Ti, vLLM TP=4) but machine-agnostic: point it at any vLLM instance and any number of GPUs.

## Components

| Dir | What | Deployed as |
|---|---|---|
| `stream-hub/` | Metric hub: samplers + WS fan-out + push endpoint | systemd service, `127.0.0.1:9797` |
| `grafana-live-ds/` | Grafana streaming datasource plugin (`home-llm-live`) | plugin in Grafana's plugins dir |

## Architecture

```
vLLM :8000 /metrics ──(200 ms poll)──┐
nvidia-smi ──────────(500 ms poll)───┼──> stream-hub ──WS──> home-llm-live plugin ──> Grafana panels
vram-oc-guard ───────(POST /push)───┘        │
                                             └── POST /push (any client can push metrics)
```

- Hub keeps recent history per metric; on WS connect it sends a snapshot, then ~100 ms-coalesced update batches.
- WS message format: `{"type":"snapshot|update","data":[[metric, unix_ms, value],...]}`
- Subscribers can filter by metric prefix: `/stream?metrics=vllm.,gpu0_asus_dual.`
- Prometheus stays the system of record (history + alerts); this is the live glass.

## Building

```sh
cd stream-hub && go build -ldflags="-s -w" -o stream-hub .
cd ../grafana-live-ds && npm install && npm run build \
  && go build -ldflags="-s -w" -o dist/gpx_home_llm_live_linux_amd64 ./pkg
```

Style checks (blank-line-after-block rule + gofumpt): `./tools/lint.sh` from the repo root.

## Deployment gotchas

- Grafana 13 ignores the plugin's `executable` field — the binary must be named `gpx_home_llm_live_linux_amd64`.
- Unsigned plugin: set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=home-llm-live`.
- The Grafana plugins dir must be owned by the container user (uid 472 in the home server's compose setup).
- Replace the plugin binary only while Grafana is stopped (text-file-busy).
- The plugin's health check translates `ws://` → `http://` when calling the hub's `/healthz`.

#!/usr/bin/env bash
# Style checks for all Go code in this repo.
#
# Requires (install once):
#   go install github.com/bombsimon/wsl/v5/cmd/wsl@latest
#   go install mvdan.cc/gofumpt@latest
set -euo pipefail
cd "$(dirname "$0")/.."

WSL=${WSL:-$HOME/go/bin/wsl}
GOFUMPT=${GOFUMPT:-$HOME/go/bin/gofumpt}

# wsl: blank line after block statements (if/for/switch/select), per house style.
(cd stream-hub && "$WSL" --default none --enable after-block ./...)
(cd grafana-live-ds && "$WSL" --default none --enable after-block ./pkg/...)

# gofumpt: stricter gofmt.
"$GOFUMPT" -l stream-hub/main.go stream-hub/samplers/*.go \
  grafana-live-ds/pkg/main.go grafana-live-ds/pkg/plugin/*.go

echo "style OK"

#!/bin/bash
# Reticulate launcher. Double-click in Finder, or run ./Reticulate.command in a terminal.
# Sets up whatever is missing, starts the engine (port 8000) and the interface (port 5173),
# and opens the browser. Close the window or press Ctrl+C to stop.

set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
ENGINE="$ROOT/engine"
WEB="$ROOT/web"
say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

if [ ! -x "$ENGINE/.venv/bin/reticulate" ]; then
  say "Setting up the Python environment (first run only, a few minutes)…"
  python3 -m venv "$ENGINE/.venv"
  "$ENGINE/.venv/bin/pip" install -q --upgrade pip
  "$ENGINE/.venv/bin/pip" install -q -e "$ENGINE[neuro]"
fi

if [ ! -d "$WEB/node_modules" ]; then
  say "Installing the interface (first run only)…"
  (cd "$WEB" && npm install --no-audit --no-fund)
fi

if [ ! -f "$WEB/public/atlas/vocabulary.json" ] || [ ! -f "$ENGINE/.cache/projector.npz" ]; then
  say "Building the brain atlas (downloads fsaverage, NeuroQuery, Neurosynth and the Cognitive Atlas once)…"
  "$ENGINE/.venv/bin/python" -c "import mne; mne.datasets.fetch_fsaverage(verbose=False)"
  "$ENGINE/.venv/bin/reticulate" build-atlas
fi

if [ -z "$ANTHROPIC_API_KEY" ] && ! grep -Eqs '^ANTHROPIC_API_KEY=.+' "$ENGINE/.env"; then
  say "To analyse decisions, click “Connect Claude” in Reticulate and paste an Anthropic API key."
fi

# Stop an earlier Reticulate that is still running; never touch other programs.
for port in 8000 5173; do
  pid=$(lsof -ti tcp:$port -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pid" ]; then
    if curl -s "http://localhost:$port/api/status" | grep -q science_version \
      || curl -s "http://localhost:$port" | grep -q "<title>Reticulate"; then
      kill $pid 2>/dev/null || true
      sleep 1
    else
      say "Port $port is used by another program. Close that program and start Reticulate again."
      exit 1
    fi
  fi
done

say "Starting Reticulate…"
"$ENGINE/.venv/bin/reticulate" serve --port 8000 > "$ENGINE/.server.log" 2>&1 &
API=$!
cd "$WEB"
"$WEB/node_modules/.bin/vite" --host 127.0.0.1 --port 5173 --strictPort > "$WEB/.vite.log" 2>&1 &
UI=$!
cd "$ROOT"
trap 'kill $API $UI 2>/dev/null; exit 0' INT TERM HUP EXIT

for _ in $(seq 1 80); do
  if curl -s http://localhost:8000/api/status > /dev/null && curl -s http://localhost:5173 > /dev/null; then
    break
  fi
  sleep 0.5
done

[ -z "$RETICULATE_NO_BROWSER" ] && open "http://localhost:5173"
say "Reticulate is running at http://localhost:5173"
echo "Your decisions are saved in $ROOT/data/decisions"
echo "Close this window or press Ctrl+C to stop. Logs: engine/.server.log, web/.vite.log"
wait

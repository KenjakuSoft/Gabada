#!/usr/bin/env bash
# Linux / macOS process killer for Gabada.

set -uo pipefail

pids="$(pgrep -f 'desktop_launcher.py' 2>/dev/null || true)"

if [[ -z "$pids" ]]; then
    echo "Gabada is not running."
    exit 0
fi

echo "Stopping Gabada (PIDs: $pids)..."
echo "$pids" | xargs -r kill 2>/dev/null || true

# Give it a moment to shut down gracefully, then SIGKILL anything that survived.
sleep 1
remaining="$(pgrep -f 'desktop_launcher.py' 2>/dev/null || true)"
if [[ -n "$remaining" ]]; then
    echo "$remaining" | xargs -r kill -9 2>/dev/null || true
fi

echo "Gabada stopped."

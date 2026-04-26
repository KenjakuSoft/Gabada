#!/usr/bin/env bash
# Linux / macOS launcher for Gabada.
# Boots the desktop launcher from the local backend venv (or system python3).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
LAUNCHER="$BACKEND_DIR/desktop_launcher.py"

if [[ ! -d "$BACKEND_DIR" ]]; then
    echo "Backend folder not found:"
    echo "  $BACKEND_DIR"
    exit 1
fi

if [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
    PYTHON="$BACKEND_DIR/.venv/bin/python"
elif [[ -x "$BACKEND_DIR/.venv/bin/python3" ]]; then
    PYTHON="$BACKEND_DIR/.venv/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON="$(command -v python3)"
    echo "Note: backend venv missing — falling back to system python3."
    echo "      For best results, run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
else
    echo "No Python interpreter found."
    echo "Install Python 3.11+ and create the backend venv:"
    echo "  cd $BACKEND_DIR"
    echo "  python3 -m venv .venv"
    echo "  .venv/bin/pip install -r requirements.txt"
    exit 1
fi

if [[ ! -f "$LAUNCHER" ]]; then
    echo "Desktop launcher not found:"
    echo "  $LAUNCHER"
    exit 1
fi

echo "Starting Gabada..."
cd "$BACKEND_DIR"
exec "$PYTHON" "$LAUNCHER"

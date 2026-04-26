#!/usr/bin/env bash
# Linux / macOS release build script for Gabada.
# Mirrors packaging/windows/build_installer.ps1 but produces a portable tar.gz
# instead of a native installer.

set -euo pipefail

usage() {
    cat <<EOF
Usage: $(basename "$0") [--skip-frontend-build] [--app-version VERSION]

Environment:
  PYTHON   Path to the Python interpreter to use
           (default: <repo>/backend/.venv/bin/python)
EOF
}

SKIP_FRONTEND=0
APP_VERSION="${APP_VERSION:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-frontend-build) SKIP_FRONTEND=1; shift ;;
        --app-version) APP_VERSION="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON="${PYTHON:-$ROOT/backend/.venv/bin/python}"
FRONTEND_DIR="$ROOT/frontend-web"
SPEC_PATH="$SCRIPT_DIR/gabada.spec"
REQS="$ROOT/packaging/windows/requirements.txt"
BROWSER_CACHE="$ROOT/.cache/playwright-browsers"
BUILD_DIR="$SCRIPT_DIR/build"
DIST_DIR="$SCRIPT_DIR/dist"
OUTPUT_DIR="$SCRIPT_DIR/output"

if [[ ! -x "$PYTHON" ]]; then
    echo "Error: Python interpreter not found at $PYTHON" >&2
    echo "Create the backend venv first or pass PYTHON=/path/to/python." >&2
    exit 1
fi

if [[ ! -f "$SPEC_PATH" ]]; then
    echo "Error: PyInstaller spec missing: $SPEC_PATH" >&2
    exit 1
fi

echo "Installing packaging requirements..."
"$PYTHON" -m pip install -r "$REQS"

if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
    echo "Building frontend..."
    (cd "$FRONTEND_DIR" && npm run build)
fi

echo "Preparing Playwright Chromium bundle..."
mkdir -p "$BROWSER_CACHE"
PLAYWRIGHT_BROWSERS_PATH="$BROWSER_CACHE" "$PYTHON" -m playwright install chromium

echo "Building desktop bundle with PyInstaller..."
rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$OUTPUT_DIR"

"$PYTHON" -m PyInstaller \
    --noconfirm \
    --clean \
    --distpath "$DIST_DIR" \
    --workpath "$BUILD_DIR" \
    "$SPEC_PATH"

case "$(uname -s)" in
    Linux*) PLATFORM="linux" ;;
    Darwin*) PLATFORM="macos" ;;
    *) echo "Unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) ARCH="$(uname -m)" ;;
esac

VERSION_TAG="${APP_VERSION:-dev}"
ARCHIVE_NAME="Gabada-v${VERSION_TAG}-${PLATFORM}-${ARCH}.tar.gz"

echo "Creating $ARCHIVE_NAME..."
tar -czf "$OUTPUT_DIR/$ARCHIVE_NAME" -C "$DIST_DIR" Gabada

echo "Done."
echo "Bundle:  $DIST_DIR/Gabada"
echo "Archive: $OUTPUT_DIR/$ARCHIVE_NAME"

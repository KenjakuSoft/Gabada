from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import _is_allowed_browser_origin  # noqa: E402


def test_allows_desktop_and_vite_local_origins() -> None:
    assert _is_allowed_browser_origin("http://127.0.0.1:8000")
    assert _is_allowed_browser_origin("http://localhost:8007")
    assert _is_allowed_browser_origin("http://localhost:5173")


def test_rejects_external_browser_origins() -> None:
    assert not _is_allowed_browser_origin("https://example.com")
    assert not _is_allowed_browser_origin("http://malicious.test")
    assert not _is_allowed_browser_origin("null")

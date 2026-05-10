from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database.models import ScrapeConfig  # noqa: E402
from scraper import stealth  # noqa: E402


def test_is_available_returns_bool() -> None:
    assert isinstance(stealth.is_available(), bool)


def test_stealth_navigate_yields_none_when_seleniumbase_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force `from seleniumbase import cdp_driver` to raise ImportError even
    # if seleniumbase happens to be installed in the test environment.
    monkeypatch.setitem(sys.modules, "seleniumbase", None)

    async def run() -> object:
        async with stealth.stealth_navigate(
            playwright=None,
            url="https://example.com",
            config=ScrapeConfig(),
        ) as page:
            return page

    assert asyncio.run(run()) is None


def test_storage_state_cookies_returns_empty_when_path_unset() -> None:
    assert stealth._storage_state_cookies(ScrapeConfig()) == []


def test_storage_state_cookies_returns_empty_when_file_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path))
    sessions = tmp_path / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    config = ScrapeConfig(storage_state_path=str(sessions / "does-not-exist.json"))
    assert stealth._storage_state_cookies(config) == []


def test_storage_state_cookies_extracts_cookies_array(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path))
    sessions = tmp_path / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    state_file = sessions / "state.json"
    state_file.write_text(
        '{"cookies": [{"name": "sid", "value": "abc", "domain": ".example.com", '
        '"path": "/"}], "origins": []}',
        encoding="utf-8",
    )
    config = ScrapeConfig(storage_state_path=str(state_file))
    cookies = stealth._storage_state_cookies(config)
    assert len(cookies) == 1
    assert cookies[0]["name"] == "sid"


def test_storage_state_cookies_rejects_path_traversal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Paths that escape sessions_dir must be ignored, not silently followed."""
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path / "data"))
    outside = tmp_path / "outside.json"
    outside.write_text(
        '{"cookies": [{"name": "leak", "value": "x", "domain": "ex.com", "path": "/"}]}',
        encoding="utf-8",
    )
    config = ScrapeConfig(storage_state_path=str(outside))
    assert stealth._storage_state_cookies(config) == []

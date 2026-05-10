"""Regression tests for the v0.6.x security hardening pass.

Covers:
    - Path-confinement on ``resolve_storage_state_path`` (no escape outside
      ``sessions_dir`` / ``backend_dir``).
    - The ``/scraper/probe``, ``/scraper/selector-lab``, ``/scraper/scrape-test``,
      and ``/scraper/login-session`` endpoints reject non-http(s) URLs.
    - The ``/api/*`` middleware rejects requests with a non-local Host header
      (DNS-rebinding defense) even when Origin / Sec-Fetch-Site are absent.
    - Responses carry the expected security headers.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402

import main as backend_main  # noqa: E402
from app_paths import resolve_storage_state_path  # noqa: E402


# ── Path confinement ────────────────────────────────────────────────────────


def test_resolve_storage_state_path_rejects_absolute_escape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path / "data"))
    target = tmp_path / "outside.json"
    with pytest.raises(ValueError):
        resolve_storage_state_path(str(target))


def test_resolve_storage_state_path_rejects_dotdot_escape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path / "data"))
    with pytest.raises(ValueError):
        resolve_storage_state_path("../../etc/passwd")


def test_resolve_storage_state_path_allows_inside_sessions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path / "data"))
    sessions = tmp_path / "data" / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    resolved = resolve_storage_state_path("login.json", for_write=True)
    assert resolved.is_relative_to(sessions.resolve())


# ── Host header guard ───────────────────────────────────────────────────────


def test_is_allowed_host_header_accepts_loopback() -> None:
    assert backend_main._is_allowed_host_header("127.0.0.1:8000")
    assert backend_main._is_allowed_host_header("localhost:5173")
    assert backend_main._is_allowed_host_header("[::1]:8000")


def test_is_allowed_host_header_rejects_external() -> None:
    assert not backend_main._is_allowed_host_header("evil.example:8000")
    assert not backend_main._is_allowed_host_header("attacker.com")
    assert not backend_main._is_allowed_host_header("")
    assert not backend_main._is_allowed_host_header(None)


def test_is_allowed_host_header_rejects_unknown_loopback_port() -> None:
    # 9000 isn't in the local browser port allowlist.
    assert not backend_main._is_allowed_host_header("127.0.0.1:9000")


# ── Middleware: rebound DNS / missing Origin ────────────────────────────────


@pytest.fixture()
def client() -> TestClient:
    return TestClient(backend_main.app, raise_server_exceptions=False)


def test_api_blocks_request_with_external_host_header(client: TestClient) -> None:
    """Request from rebound evil.example resolving to 127.0.0.1 must 403."""
    response = client.get("/api/health", headers={"host": "evil.example:8000"})
    # /api/health doesn't exist; what matters is we never get past the guard
    # to the route. 403 means the middleware rejected it.
    assert response.status_code == 403
    assert response.json()["detail"] == "Untrusted Host header"


def test_api_blocks_cross_origin_request(client: TestClient) -> None:
    response = client.get(
        "/api/settings/",
        headers={
            "host": "127.0.0.1:8000",
            "origin": "https://evil.example",
        },
    )
    assert response.status_code == 403


def test_api_blocks_cross_site_sec_fetch(client: TestClient) -> None:
    response = client.get(
        "/api/settings/",
        headers={
            "host": "127.0.0.1:8000",
            "sec-fetch-site": "cross-site",
        },
    )
    assert response.status_code == 403


def test_health_endpoint_carries_security_headers(client: TestClient) -> None:
    response = client.get("/health", headers={"host": "127.0.0.1:8000"})
    assert response.status_code == 200
    # /health is not under /api so the middleware never *blocks* it, but
    # the security headers must still be applied.
    assert response.headers.get("x-frame-options") == "DENY"
    assert "frame-ancestors 'none'" in response.headers.get(
        "content-security-policy", ""
    )
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("referrer-policy") == "no-referrer"


# ── URL scheme guard for scraper inputs ─────────────────────────────────────


def test_probe_rejects_file_scheme(client: TestClient) -> None:
    response = client.post(
        "/api/scraper/probe",
        json={"url": "file:///etc/passwd"},
        headers={"host": "127.0.0.1:8000"},
    )
    assert response.status_code == 400
    assert "http://" in response.json()["detail"]


def test_probe_rejects_javascript_scheme(client: TestClient) -> None:
    response = client.post(
        "/api/scraper/probe",
        json={"url": "javascript:alert(1)"},
        headers={"host": "127.0.0.1:8000"},
    )
    assert response.status_code == 400


def test_selector_lab_rejects_data_scheme(client: TestClient) -> None:
    response = client.post(
        "/api/scraper/selector-lab",
        json={"url": "data:text/html,<script>alert(1)</script>"},
        headers={"host": "127.0.0.1:8000"},
    )
    assert response.status_code == 400


def test_login_session_rejects_path_traversal_in_save_path(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/scraper/login-session",
        json={
            "url": "https://example.com/login",
            "save_path": "../../../etc/passwd",
        },
        headers={"host": "127.0.0.1:8000"},
    )
    assert response.status_code == 400

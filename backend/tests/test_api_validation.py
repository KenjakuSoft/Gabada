"""Regression tests for API input validation and scrape outcome semantics."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import activity as activity_api  # noqa: E402
from api import logs as logs_api  # noqa: E402
from api import scraper_routes  # noqa: E402


class _EmptyDb:
    async def execute_fetchall(self, *args, **kwargs):
        return []

    async def close(self) -> None:
        return None


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    async def fake_get_db():
        return _EmptyDb()

    monkeypatch.setattr(logs_api, "get_db", fake_get_db)
    monkeypatch.setattr(activity_api, "get_db", fake_get_db)

    app = FastAPI()
    app.include_router(logs_api.router)
    app.include_router(activity_api.router)
    return TestClient(app)


# ── Limit validation ────────────────────────────────────────────────────────


@pytest.mark.parametrize("limit", [0, -1, 1001])
def test_logs_rejects_out_of_range_limit(client: TestClient, limit: int) -> None:
    response = client.get("/logs/", params={"product_store_id": 1, "limit": limit})

    assert response.status_code == 422


def test_logs_accepts_minimum_limit(client: TestClient) -> None:
    response = client.get("/logs/", params={"product_store_id": 1, "limit": 1})

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("limit", [0, -1, 5001])
def test_product_logs_reject_out_of_range_limit(client: TestClient, limit: int) -> None:
    response = client.get(f"/logs/product/1", params={"limit": limit})

    assert response.status_code == 422


def test_product_logs_accept_minimum_limit(client: TestClient) -> None:
    response = client.get("/logs/product/1", params={"limit": 1})

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("limit", [0, -1, 501])
def test_activity_rejects_out_of_range_limit(client: TestClient, limit: int) -> None:
    response = client.get("/activity/", params={"limit": limit})

    assert response.status_code == 422


def test_activity_rejects_negative_offset(client: TestClient) -> None:
    response = client.get("/activity/", params={"offset": -1})

    assert response.status_code == 422


def test_activity_accepts_minimum_limit(client: TestClient) -> None:
    response = client.get("/activity/", params={"limit": 1})

    assert response.status_code == 200
    assert response.json() == []


# ── Manual scrape outcome semantics ─────────────────────────────────────────


def _patch_scrape(monkeypatch: pytest.MonkeyPatch, summary: dict) -> None:
    async def fake_scrape(product_store_id: int) -> dict:
        return summary

    monkeypatch.setattr(scraper_routes, "_do_scrape", fake_scrape)


def test_manual_scrape_returns_409_for_manual_only_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_scrape(
        monkeypatch,
        {"status": "skipped", "product_store_id": 1, "reason": "manual_only"},
    )

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(scraper_routes.manual_scrape(1))

    assert excinfo.value.status_code == 409


def test_manual_scrape_returns_skipped_summary_when_no_price(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    summary = {
        "status": "skipped",
        "product_store_id": 1,
        "reason": "no_price",
        "result": object(),
    }
    _patch_scrape(monkeypatch, summary)

    response = asyncio.run(scraper_routes.manual_scrape(1))

    # A no-price scrape is a normal "nothing changed" outcome, not a conflict.
    assert response is summary
    assert response["status"] == "skipped"
    assert response["reason"] == "no_price"


def test_manual_scrape_returns_404_for_missing_link(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_scrape(
        monkeypatch,
        {
            "status": "not_found",
            "product_store_id": 1,
            "error": "Product store not found or inactive",
        },
    )

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(scraper_routes.manual_scrape(1))

    assert excinfo.value.status_code == 404


def test_manual_scrape_returns_502_for_failed_scrape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_scrape(
        monkeypatch,
        {"status": "failed", "product_store_id": 1, "error": "blocked"},
    )

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(scraper_routes.manual_scrape(1))

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "blocked"

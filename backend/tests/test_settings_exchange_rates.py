"""Regression tests for exchange-rate hardening in the settings API."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import settings as settings_api  # noqa: E402
from database.models import SettingsUpdate  # noqa: E402


def _row(exchange_rates: str) -> dict:
    return {
        "currency_code": "USD",
        "currency_symbol": "$",
        "country_code": "US",
        "timezone": "UTC",
        "scrape_cron": "0 8 * * *",
        "scrape_enabled": 1,
        "locale": "en-US",
        "price_display_mode": "regional",
        "exchange_rates": exchange_rates,
        "theme": "system",
        "updated_at": None,
    }


# ── Reading stored values ───────────────────────────────────────────────────


def test_invalid_exchange_rate_json_falls_back_to_empty_map() -> None:
    result = settings_api._row_to_settings(_row("{not json"))

    assert result.exchange_rates == {}


def test_non_object_exchange_rate_json_falls_back_to_empty_map() -> None:
    result = settings_api._row_to_settings(_row("[1, 2, 3]"))

    assert result.exchange_rates == {}


def test_only_invalid_exchange_rate_entries_are_dropped() -> None:
    # One corrupt entry used to discard every configured rate for the row.
    result = settings_api._row_to_settings(
        _row(
            '{"USD": 1, "eur": "0.92", "BAD": "nope", "": 2.5,'
            ' "ZERO": 0, "NEG": -1, "INF": Infinity}'
        )
    )

    assert result.exchange_rates == {"USD": 1.0, "EUR": 0.92}


def test_exchange_rate_codes_are_normalized() -> None:
    result = settings_api._row_to_settings(_row('{"  gbp  ": "0.79"}'))

    assert result.exchange_rates == {"GBP": 0.79}


# ── Writing values ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "rate",
    [0.0, -1.0, float("nan"), float("inf"), float("-inf")],
)
def test_update_rejects_non_positive_or_non_finite_rate(rate: float) -> None:
    # Validation happens before any database access.
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            settings_api.update_settings(
                SettingsUpdate(exchange_rates={"USD": rate})
            )
        )

    assert excinfo.value.status_code == 400
    assert "USD" in excinfo.value.detail

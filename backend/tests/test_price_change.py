"""Regression tests for the shared price-change classifier.

Both the Playwright scraper and the file/API importers called near-identical
copies of this logic. These tests lock the shared behavior, especially the
cases the old copies disagreed on:

    - the first price observed after a price-less snapshot is ``new``
    - sub-cent float noise is not reported as a price movement
    - a sale price wins over the regular price on both sides of the diff
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiosqlite

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.import_routes import _latest_price_log as import_latest_log  # noqa: E402
from api.price_log_utils import (  # noqa: E402
    PriceSnapshot,
    compute_price_change,
    effective_price,
)
from services.api_catalog import _latest_price_log as catalog_latest_log  # noqa: E402


# ── Effective price ─────────────────────────────────────────────────────────


def test_effective_price_prefers_discount() -> None:
    assert effective_price(120.0, 99.0) == 99.0


def test_effective_price_uses_regular_price_without_discount() -> None:
    assert effective_price(120.0, None) == 120.0


def test_effective_price_respects_explicit_zero_discount() -> None:
    # A free promo is a real price, not a missing one.
    assert effective_price(120.0, 0.0) == 0.0


def test_effective_price_none_when_both_missing() -> None:
    assert effective_price(None, None) is None


# ── Classification ──────────────────────────────────────────────────────────


def test_missing_previous_snapshot_is_new() -> None:
    change = compute_price_change(PriceSnapshot(price=10.0), None)

    assert change.change_type == "new"
    assert change.price_delta is None
    assert change.previous_price is None


def test_first_price_after_price_less_snapshot_is_new() -> None:
    previous = PriceSnapshot(price=None, stock_status="in_stock")
    current = PriceSnapshot(price=25.0, stock_status="in_stock")

    change = compute_price_change(current, previous)

    assert change.change_type == "new"
    assert change.price_delta is None
    assert change.previous_price is None
    assert change.previous_stock_status == "in_stock"


def test_sub_cent_float_noise_is_no_change() -> None:
    previous = PriceSnapshot(price=100.0)
    current = PriceSnapshot(price=100.004)

    change = compute_price_change(current, previous)

    assert change.change_type == "no_change"
    assert change.price_delta is None
    assert change.previous_price == 100.0


def test_price_increase_reports_positive_delta() -> None:
    change = compute_price_change(
        PriceSnapshot(price=110.5),
        PriceSnapshot(price=100.0),
    )

    assert change.change_type == "price_up"
    assert change.price_delta == 10.5
    assert change.previous_price == 100.0


def test_price_decrease_reports_negative_delta() -> None:
    change = compute_price_change(
        PriceSnapshot(price=90.0),
        PriceSnapshot(price=100.0),
    )

    assert change.change_type == "price_down"
    assert change.price_delta == -10.0


def test_sale_price_is_compared_instead_of_regular_price() -> None:
    change = compute_price_change(
        PriceSnapshot(price=90.0, discounted_price=70.0),
        PriceSnapshot(price=100.0, discounted_price=80.0),
    )

    assert change.change_type == "price_down"
    assert change.price_delta == -10.0
    assert change.previous_price == 80.0


def test_removing_a_discount_is_a_price_increase() -> None:
    change = compute_price_change(
        PriceSnapshot(price=90.0, discounted_price=None),
        PriceSnapshot(price=100.0, discounted_price=80.0),
    )

    assert change.change_type == "price_up"
    assert change.price_delta == 10.0
    assert change.previous_price == 80.0


def test_price_and_stock_change_together() -> None:
    change = compute_price_change(
        PriceSnapshot(price=90.0, stock_status="out_of_stock"),
        PriceSnapshot(price=100.0, stock_status="in_stock"),
    )

    assert change.change_type == "price_and_stock"
    assert change.price_delta == -10.0


def test_stock_out_is_classified() -> None:
    change = compute_price_change(
        PriceSnapshot(price=100.0, stock_status="out_of_stock"),
        PriceSnapshot(price=100.0, stock_status="in_stock"),
    )

    assert change.change_type == "stock_out"


def test_stock_in_is_classified() -> None:
    change = compute_price_change(
        PriceSnapshot(price=100.0, stock_status="in_stock"),
        PriceSnapshot(price=100.0, stock_status="out_of_stock"),
    )

    assert change.change_type == "stock_in"


def test_limited_stock_counts_as_available() -> None:
    change = compute_price_change(
        PriceSnapshot(price=100.0, stock_status="limited"),
        PriceSnapshot(price=100.0, stock_status="out_of_stock"),
    )

    assert change.change_type == "stock_in"


def test_unrecognized_stock_value_uses_generic_stock_change() -> None:
    change = compute_price_change(
        PriceSnapshot(price=100.0, stock_status="backorder"),
        PriceSnapshot(price=100.0, stock_status="in_stock"),
    )

    assert change.change_type == "stock_change"


def test_missing_stock_status_normalizes_to_unknown() -> None:
    change = compute_price_change(
        PriceSnapshot(price=100.0, stock_status=None),
        PriceSnapshot(price=100.0, stock_status="in_stock"),
    )

    assert change.change_type == "stock_change"
    assert change.previous_stock_status == "in_stock"


def test_identical_snapshots_are_no_change() -> None:
    change = compute_price_change(
        PriceSnapshot(price=100.0, discounted_price=80.0, stock_status="in_stock"),
        PriceSnapshot(price=100.0, discounted_price=80.0, stock_status="in_stock"),
    )

    assert change.change_type == "no_change"
    assert change.price_delta is None


def test_snapshot_from_row_reads_only_needed_columns() -> None:
    snapshot = PriceSnapshot.from_row(
        {
            "price": 12.5,
            "discounted_price": None,
            "stock_status": "in_stock",
        }
    )

    assert snapshot == PriceSnapshot(
        price=12.5,
        discounted_price=None,
        stock_status="in_stock",
    )


# ── Latest-log tie-breaker ──────────────────────────────────────────────────


async def _seed_same_timestamp_logs(path: Path) -> None:
    async with aiosqlite.connect(path) as db:
        await db.execute(
            """CREATE TABLE price_logs (
                   id INTEGER PRIMARY KEY,
                   product_store_id INTEGER NOT NULL,
                   price REAL,
                   discounted_price REAL,
                   stock_status TEXT,
                   scraped_at DATETIME
               )"""
        )
        await db.executescript(
            """
            INSERT INTO price_logs
                (id, product_store_id, price, stock_status, scraped_at)
            VALUES
                (1, 1, 10.0, 'in_stock', '2026-01-01 00:00:00'),
                (2, 1, 14.0, 'out_of_stock', '2026-01-01 00:00:00');
            """
        )
        await db.commit()


def test_import_latest_log_breaks_timestamp_ties_by_id(tmp_path: Path) -> None:
    db_path = tmp_path / "gabada.db"
    asyncio.run(_seed_same_timestamp_logs(db_path))

    async def read() -> dict:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            return await import_latest_log(db, 1)

    latest = asyncio.run(read())
    assert latest["price"] == 14.0


def test_catalog_latest_log_breaks_timestamp_ties_by_id(tmp_path: Path) -> None:
    db_path = tmp_path / "gabada.db"
    asyncio.run(_seed_same_timestamp_logs(db_path))

    async def read() -> dict:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            return await catalog_latest_log(db, 1)

    latest = asyncio.run(read())
    assert latest["price"] == 14.0

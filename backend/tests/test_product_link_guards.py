"""Regression tests for product/store-link ownership and duplicate guards."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiosqlite
import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database.db as db_module  # noqa: E402
from api import products as products_api  # noqa: E402
from database.models import (  # noqa: E402
    ProductStoreCreate,
    ProductStoreOverrideUpsert,
)


async def _seed(path: Path) -> None:
    async with aiosqlite.connect(path) as db:
        await db.executescript(
            """
            INSERT INTO products (id, canonical_name)
            VALUES (1, 'GPU'), (2, 'CPU'), (3, 'RAM');

            INSERT INTO stores (id, name, base_url)
            VALUES (1, 'Shop', 'https://shop.test'),
                   (2, 'Other', 'https://other.test');

            INSERT INTO product_stores (id, product_id, store_id, product_url)
            VALUES (1, 1, 1, 'https://shop.test/gpu'),
                   (2, 2, 1, 'https://shop.test/cpu');

            INSERT INTO product_store_overrides
                (product_store_id, manual_price, manual_stock_status,
                 manual_warranty, override_note)
            VALUES (2, 50.0, 'in_stock', '1 year', 'seeded');
            """
        )
        await db.commit()


async def _scalar(path: Path, sql: str, params: tuple = ()) -> object:
    async with aiosqlite.connect(path) as db:
        rows = await db.execute_fetchall(sql, params)
        return rows[0][0]


@pytest.fixture()
def db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "gabada.db"
    monkeypatch.setattr(db_module, "DB_PATH", str(path))
    asyncio.run(db_module.init_db())
    asyncio.run(_seed(path))
    return path


# ── Adding a store link ─────────────────────────────────────────────────────


def test_add_store_link_rejects_missing_product(db_path: Path) -> None:
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            products_api.add_store_link(
                99,
                ProductStoreCreate(
                    store_id=1,
                    product_url="https://shop.test/new",
                    auto_detect=False,
                ),
            )
        )

    assert excinfo.value.status_code == 404
    assert asyncio.run(
        _scalar(db_path, "SELECT COUNT(*) FROM product_stores")
    ) == 2


def test_add_store_link_rejects_duplicate_store(db_path: Path) -> None:
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            products_api.add_store_link(
                1,
                ProductStoreCreate(
                    store_id=1,
                    product_url="https://shop.test/another-gpu",
                    auto_detect=False,
                ),
            )
        )

    assert excinfo.value.status_code == 409
    assert asyncio.run(
        _scalar(db_path, "SELECT COUNT(*) FROM product_stores")
    ) == 2


def test_add_store_link_rejects_missing_store(db_path: Path) -> None:
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            products_api.add_store_link(
                3,
                ProductStoreCreate(
                    store_id=99,
                    product_url="https://other.test/ram",
                    auto_detect=False,
                ),
            )
        )

    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "Store not found"


def test_add_store_link_creates_active_link(db_path: Path) -> None:
    summary = asyncio.run(
        products_api.add_store_link(
            3,
            ProductStoreCreate(
                store_id=2,
                product_url="https://other.test/ram",
                auto_detect=False,
            ),
        )
    )

    assert summary.id == 3
    assert summary.store_name == "Other"
    assert summary.product_url == "https://other.test/ram"
    assert summary.is_active is True
    assert asyncio.run(
        _scalar(
            db_path,
            "SELECT product_url FROM product_stores WHERE id = 3",
        )
    ) == "https://other.test/ram"


# ── Override ownership ──────────────────────────────────────────────────────


def test_override_read_requires_link_to_belong_to_product(db_path: Path) -> None:
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(products_api.get_override(1, 2))

    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "Store link not found"


def test_override_upsert_requires_link_to_belong_to_product(db_path: Path) -> None:
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            products_api.upsert_override(
                1,
                2,
                ProductStoreOverrideUpsert(manual_price=1.0),
            )
        )

    assert excinfo.value.status_code == 404
    assert asyncio.run(
        _scalar(
            db_path,
            "SELECT manual_price FROM product_store_overrides "
            "WHERE product_store_id = 2",
        )
    ) == 50.0


def test_override_upsert_updates_owned_link(db_path: Path) -> None:
    result = asyncio.run(
        products_api.upsert_override(
            2,
            2,
            ProductStoreOverrideUpsert(
                manual_price=42.5,
                manual_stock_status="limited",
                manual_warranty="2 years",
                override_note="price matched",
            ),
        )
    )

    assert result.product_store_id == 2
    assert result.manual_price == 42.5
    assert result.manual_stock_status == "limited"
    assert result.manual_warranty == "2 years"
    assert result.override_note == "price matched"


def test_override_delete_requires_link_to_belong_to_product(db_path: Path) -> None:
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(products_api.delete_override(1, 2))

    assert excinfo.value.status_code == 404
    assert asyncio.run(
        _scalar(
            db_path,
            "SELECT COUNT(*) FROM product_store_overrides "
            "WHERE product_store_id = 2",
        )
    ) == 1


def test_override_delete_removes_owned_override(db_path: Path) -> None:
    asyncio.run(products_api.delete_override(2, 2))

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(products_api.get_override(2, 2))

    assert excinfo.value.status_code == 404

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiosqlite

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api import products as products_api  # noqa: E402
from database.models import ProductStoreUpdate  # noqa: E402


async def _seed_db(path: Path) -> None:
    async with aiosqlite.connect(path) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        await db.executescript(
            """
            CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                canonical_name TEXT NOT NULL,
                image_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE stores (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                base_url TEXT NOT NULL,
                manual_only INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE product_stores (
                id INTEGER PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
                product_url TEXT NOT NULL,
                scrape_config TEXT NOT NULL DEFAULT '{}',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE price_logs (
                id INTEGER PRIMARY KEY,
                product_store_id INTEGER NOT NULL REFERENCES product_stores(id) ON DELETE CASCADE,
                scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                title TEXT,
                price REAL,
                discounted_price REAL,
                dealer_price REAL,
                warranty TEXT,
                stock_status TEXT DEFAULT 'unknown',
                raw_price TEXT,
                raw_discounted TEXT,
                raw_dealer TEXT,
                currency_code TEXT,
                change_type TEXT,
                price_delta REAL,
                previous_price REAL,
                previous_stock_status TEXT
            );

            CREATE TABLE product_store_overrides (
                id INTEGER PRIMARY KEY,
                product_store_id INTEGER NOT NULL REFERENCES product_stores(id) ON DELETE CASCADE UNIQUE,
                manual_price REAL,
                manual_stock_status TEXT,
                manual_warranty TEXT,
                imported_dealer_price REAL,
                imported_warranty TEXT,
                override_note TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO products (id, canonical_name) VALUES (1, 'GPU');
            INSERT INTO stores (id, name, base_url) VALUES (1, 'Shop', 'https://shop.test');
            INSERT INTO product_stores (id, product_id, store_id, product_url)
            VALUES (1, 1, 1, 'https://shop.test/old');
            INSERT INTO price_logs (product_store_id, price, raw_price)
            VALUES (1, 10.0, '$10'), (1, 11.0, '$11');
            """
        )
        await db.commit()


async def _log_count(path: Path) -> int:
    async with aiosqlite.connect(path) as db:
        rows = await db.execute_fetchall(
            "SELECT COUNT(*) AS count FROM price_logs WHERE product_store_id = 1"
        )
        return int(rows[0][0])


async def _product_url(path: Path) -> str:
    async with aiosqlite.connect(path) as db:
        rows = await db.execute_fetchall(
            "SELECT product_url FROM product_stores WHERE id = 1"
        )
        return str(rows[0][0])


def test_store_url_change_can_clear_existing_logs(
    tmp_path: Path,
    monkeypatch,
) -> None:
    db_path = tmp_path / "gabada.db"
    asyncio.run(_seed_db(db_path))

    async def fake_get_db():
        db = await aiosqlite.connect(db_path)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        return db

    monkeypatch.setattr(products_api, "get_db", fake_get_db)

    asyncio.run(
        products_api.update_store_link(
            1,
            1,
            ProductStoreUpdate(
                product_url="https://shop.test/new",
                clear_logs_on_url_change=True,
            ),
        )
    )

    assert asyncio.run(_product_url(db_path)) == "https://shop.test/new"
    assert asyncio.run(_log_count(db_path)) == 0


def test_store_url_change_keeps_logs_by_default(
    tmp_path: Path,
    monkeypatch,
) -> None:
    db_path = tmp_path / "gabada.db"
    asyncio.run(_seed_db(db_path))

    async def fake_get_db():
        db = await aiosqlite.connect(db_path)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        return db

    monkeypatch.setattr(products_api, "get_db", fake_get_db)

    asyncio.run(
        products_api.update_store_link(
            1,
            1,
            ProductStoreUpdate(product_url="https://shop.test/new"),
        )
    )

    assert asyncio.run(_product_url(db_path)) == "https://shop.test/new"
    assert asyncio.run(_log_count(db_path)) == 2

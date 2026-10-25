"""Regression tests for removing a store's saved Playwright session."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiosqlite
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database.db as db_module  # noqa: E402
from api import stores as stores_api  # noqa: E402


def _prepare_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "gabada.db"
    monkeypatch.setattr(db_module, "DB_PATH", str(db_path))
    asyncio.run(db_module.init_db())
    return db_path


async def _seed_store(db_path: Path, storage_state_path: str) -> None:
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            """INSERT INTO stores (id, name, base_url, storage_state_path)
               VALUES (1, 'Shop', 'https://shop.test', ?)""",
            (storage_state_path,),
        )
        await db.commit()


async def _fetch_stores(db_path: Path) -> list[aiosqlite.Row]:
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        return await db.execute_fetchall("SELECT id FROM stores")


def test_delete_store_removes_saved_login_session_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path / "data"))
    db_path = _prepare_db(tmp_path, monkeypatch)
    asyncio.run(_seed_store(db_path, "stores/store-1-login.json"))

    session_file = (
        tmp_path / "data" / "sessions" / "stores" / "store-1-login.json"
    )
    session_file.parent.mkdir(parents=True)
    session_file.write_text("{}", encoding="utf-8")

    asyncio.run(stores_api.delete_store(1))

    assert not session_file.exists()
    assert asyncio.run(_fetch_stores(db_path)) == []


def test_delete_store_ignores_out_of_bounds_session_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Legacy rows may hold a path that is no longer allowed. Deleting the
    # store must still work and must not touch the file outside sessions.
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path / "data"))
    db_path = _prepare_db(tmp_path, monkeypatch)
    outside_file = tmp_path / "outside.json"
    outside_file.write_text("{}", encoding="utf-8")
    asyncio.run(_seed_store(db_path, str(outside_file)))

    asyncio.run(stores_api.delete_store(1))

    assert outside_file.exists()
    assert asyncio.run(_fetch_stores(db_path)) == []


def test_delete_store_ignores_missing_session_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GABADA_DATA_DIR", str(tmp_path / "data"))
    db_path = _prepare_db(tmp_path, monkeypatch)
    asyncio.run(_seed_store(db_path, "stores/already-gone.json"))

    asyncio.run(stores_api.delete_store(1))

    assert asyncio.run(_fetch_stores(db_path)) == []

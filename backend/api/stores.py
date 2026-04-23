from fastapi import APIRouter, HTTPException
from database.db import get_db
from database.models import Store, StoreCreate, StoreUpdate, WooSyncResult
from api.import_routes import sync_store_woo_catalog

router = APIRouter(prefix="/stores", tags=["stores"])

_STORE_SELECT = """
    SELECT
        id,
        name,
        base_url,
        woo_enabled,
        woo_site_url,
        woo_consumer_key,
        woo_consumer_secret,
        woo_auto_import_new,
        woo_last_synced_at,
        created_at
    FROM stores
"""


def _clean_store_fields(
    *,
    name: str,
    base_url: str,
    woo_enabled: bool,
    woo_site_url: str | None,
    woo_consumer_key: str | None,
    woo_consumer_secret: str | None,
    woo_auto_import_new: bool,
) -> dict:
    cleaned = {
        "name": name.strip(),
        "base_url": base_url.strip(),
        "woo_enabled": bool(woo_enabled),
        "woo_site_url": (woo_site_url or "").strip() or None,
        "woo_consumer_key": (woo_consumer_key or "").strip() or None,
        "woo_consumer_secret": (woo_consumer_secret or "").strip() or None,
        "woo_auto_import_new": bool(woo_auto_import_new),
    }
    if not cleaned["name"]:
        raise HTTPException(status_code=400, detail="Store name is required")
    if not cleaned["base_url"]:
        raise HTTPException(status_code=400, detail="Store base URL is required")
    if cleaned["woo_enabled"]:
        if not cleaned["woo_site_url"]:
            raise HTTPException(status_code=400, detail="Woo site URL is required when Woo sync is enabled")
        if not cleaned["woo_consumer_key"] or not cleaned["woo_consumer_secret"]:
            raise HTTPException(status_code=400, detail="Woo consumer key and secret are required when Woo sync is enabled")
    return cleaned


def _row_to_store(row) -> Store:
    return Store(
        id=row["id"],
        name=row["name"],
        base_url=row["base_url"],
        woo_enabled=bool(row["woo_enabled"]),
        woo_site_url=row["woo_site_url"],
        woo_consumer_key=row["woo_consumer_key"],
        woo_consumer_secret=row["woo_consumer_secret"],
        woo_auto_import_new=bool(row["woo_auto_import_new"]),
        woo_last_synced_at=row["woo_last_synced_at"],
        created_at=row["created_at"],
    )


@router.get("/", response_model=list[Store])
async def list_stores():
    db = await get_db()
    try:
        rows = await db.execute_fetchall(_STORE_SELECT + " ORDER BY name")
        return [_row_to_store(r) for r in rows]
    finally:
        await db.close()


@router.post("/", response_model=Store, status_code=201)
async def create_store(body: StoreCreate):
    cleaned = _clean_store_fields(
        name=body.name,
        base_url=body.base_url,
        woo_enabled=body.woo_enabled,
        woo_site_url=body.woo_site_url,
        woo_consumer_key=body.woo_consumer_key,
        woo_consumer_secret=body.woo_consumer_secret,
        woo_auto_import_new=body.woo_auto_import_new,
    )
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO stores
               (name, base_url, woo_enabled, woo_site_url, woo_consumer_key,
                woo_consumer_secret, woo_auto_import_new)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                cleaned["name"],
                cleaned["base_url"],
                int(cleaned["woo_enabled"]),
                cleaned["woo_site_url"],
                cleaned["woo_consumer_key"],
                cleaned["woo_consumer_secret"],
                int(cleaned["woo_auto_import_new"]),
            ),
        )
        await db.commit()
        row = await db.execute_fetchall(
            _STORE_SELECT + " WHERE id=?",
            (cur.lastrowid,),
        )
        return _row_to_store(row[0])
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=409, detail="Store with this base_url already exists")
        raise
    finally:
        await db.close()


@router.patch("/{store_id}", response_model=Store)
async def update_store(store_id: int, body: StoreUpdate):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Store not found")
        current = rows[0]
        cleaned = _clean_store_fields(
            name=body.name if body.name is not None else current["name"],
            base_url=body.base_url if body.base_url is not None else current["base_url"],
            woo_enabled=body.woo_enabled if body.woo_enabled is not None else bool(current["woo_enabled"]),
            woo_site_url=body.woo_site_url if body.woo_site_url is not None else current["woo_site_url"],
            woo_consumer_key=body.woo_consumer_key if body.woo_consumer_key is not None else current["woo_consumer_key"],
            woo_consumer_secret=body.woo_consumer_secret if body.woo_consumer_secret is not None else current["woo_consumer_secret"],
            woo_auto_import_new=body.woo_auto_import_new if body.woo_auto_import_new is not None else bool(current["woo_auto_import_new"]),
        )
        await db.execute(
            """UPDATE stores
               SET name = ?, base_url = ?, woo_enabled = ?, woo_site_url = ?,
                   woo_consumer_key = ?, woo_consumer_secret = ?,
                   woo_auto_import_new = ?
               WHERE id = ?""",
            (
                cleaned["name"],
                cleaned["base_url"],
                int(cleaned["woo_enabled"]),
                cleaned["woo_site_url"],
                cleaned["woo_consumer_key"],
                cleaned["woo_consumer_secret"],
                int(cleaned["woo_auto_import_new"]),
                store_id,
            ),
        )
        await db.commit()
        refreshed = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        return _row_to_store(refreshed[0])
    except HTTPException:
        raise
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=409, detail="Store with this base_url already exists")
        raise
    finally:
        await db.close()


@router.post("/{store_id}/woo-sync", response_model=WooSyncResult)
async def manual_woo_sync(store_id: int):
    return await sync_store_woo_catalog(store_id)


@router.delete("/{store_id}", status_code=204)
async def delete_store(store_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM stores WHERE id=?", (store_id,))
        await db.commit()
    finally:
        await db.close()

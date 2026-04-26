import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from app_paths import resolve_storage_state_path
from database.db import get_db
from database.models import (
    Store,
    StoreCreate,
    StoreLoginSessionRequest,
    StoreLoginSessionResponse,
    StoreUpdate,
    WooSyncResult,
)
from api.import_routes import sync_store_woo_catalog
from scraper.engine import save_login_state

router = APIRouter(prefix="/stores", tags=["stores"])

_STORE_SELECT = """
    SELECT
        id,
        name,
        base_url,
        manual_only,
        login_url,
        storage_state_path,
        session_updated_at,
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
    manual_only: bool,
    login_url: str | None,
    storage_state_path: str | None,
    woo_enabled: bool,
    woo_site_url: str | None,
    woo_consumer_key: str | None,
    woo_consumer_secret: str | None,
    woo_auto_import_new: bool,
) -> dict:
    cleaned_name = name.strip()
    cleaned_manual_only = bool(manual_only)
    cleaned_base_url = base_url.strip()
    if cleaned_manual_only and not cleaned_base_url:
        cleaned_base_url = _manual_store_base_url(cleaned_name)
    cleaned = {
        "name": cleaned_name,
        "base_url": cleaned_base_url,
        "manual_only": cleaned_manual_only,
        "login_url": (login_url or "").strip() or None,
        "storage_state_path": (storage_state_path or "").strip() or None,
        "woo_enabled": bool(woo_enabled),
        "woo_site_url": (woo_site_url or "").strip() or None,
        "woo_consumer_key": (woo_consumer_key or "").strip() or None,
        "woo_consumer_secret": (woo_consumer_secret or "").strip() or None,
        "woo_auto_import_new": bool(woo_auto_import_new),
    }
    if not cleaned["name"]:
        raise HTTPException(status_code=400, detail="Store name is required")
    if not cleaned["manual_only"] and not cleaned["base_url"]:
        raise HTTPException(status_code=400, detail="Store base URL is required")
    if cleaned["woo_enabled"]:
        if not cleaned["woo_site_url"]:
            raise HTTPException(status_code=400, detail="Woo site URL is required when Woo sync is enabled")
        if not cleaned["woo_consumer_key"] or not cleaned["woo_consumer_secret"]:
            raise HTTPException(status_code=400, detail="Woo consumer key and secret are required when Woo sync is enabled")
    return cleaned


def _manual_store_base_url(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    if not slug:
        slug = "manual-store"
    return f"manual://{slug}"


def _login_target(store: Store) -> str:
    if store.login_url:
        return store.login_url
    if store.manual_only:
        raise HTTPException(status_code=400, detail="Manual-only stores do not have a login target")
    if store.base_url.startswith(("http://", "https://")):
        return store.base_url
    raise HTTPException(status_code=400, detail="Set a login URL before capturing a session")


def _row_to_store(row) -> Store:
    return Store(
        id=row["id"],
        name=row["name"],
        base_url=row["base_url"],
        manual_only=bool(row["manual_only"]),
        login_url=row["login_url"],
        storage_state_path=row["storage_state_path"],
        session_updated_at=row["session_updated_at"],
        woo_enabled=bool(row["woo_enabled"]),
        woo_site_url=row["woo_site_url"],
        woo_consumer_key=row["woo_consumer_key"],
        woo_consumer_secret=row["woo_consumer_secret"],
        woo_auto_import_new=bool(row["woo_auto_import_new"]),
        woo_last_synced_at=row["woo_last_synced_at"],
        created_at=row["created_at"],
    )


async def _clear_store_catalog_rows(db, store_id: int) -> dict[str, int]:
    link_rows = await db.execute_fetchall(
        """SELECT
               ps.id,
               ps.product_id
           FROM product_stores ps
           WHERE ps.store_id = ?""",
        (store_id,),
    )
    if not link_rows:
        return {"removed_links": 0, "removed_products": 0, "removed_logs": 0}

    link_ids = [row["id"] for row in link_rows]
    product_ids = sorted({row["product_id"] for row in link_rows})
    link_placeholders = ", ".join("?" for _ in link_ids)
    log_count_rows = await db.execute_fetchall(
        f"""SELECT COUNT(*) AS count
            FROM price_logs
            WHERE product_store_id IN ({link_placeholders})""",
        tuple(link_ids),
    )
    removed_logs = int(log_count_rows[0]["count"]) if log_count_rows else 0

    await db.execute("DELETE FROM product_stores WHERE store_id = ?", (store_id,))

    removed_products = 0
    if product_ids:
        product_placeholders = ", ".join("?" for _ in product_ids)
        orphan_rows = await db.execute_fetchall(
            f"""SELECT p.id
                FROM products p
                WHERE p.id IN ({product_placeholders})
                  AND NOT EXISTS (
                      SELECT 1
                      FROM product_stores ps
                      WHERE ps.product_id = p.id
                  )""",
            tuple(product_ids),
        )
        orphan_ids = [row["id"] for row in orphan_rows]
        if orphan_ids:
            orphan_placeholders = ", ".join("?" for _ in orphan_ids)
            await db.execute(
                f"DELETE FROM products WHERE id IN ({orphan_placeholders})",
                tuple(orphan_ids),
            )
            removed_products = len(orphan_ids)

    return {
        "removed_links": len(link_ids),
        "removed_products": removed_products,
        "removed_logs": removed_logs,
    }


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
        manual_only=body.manual_only,
        login_url=body.login_url,
        storage_state_path=None,
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
               (name, base_url, manual_only, login_url, storage_state_path,
                woo_enabled, woo_site_url, woo_consumer_key, woo_consumer_secret,
                woo_auto_import_new)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                cleaned["name"],
                cleaned["base_url"],
                int(cleaned["manual_only"]),
                cleaned["login_url"],
                cleaned["storage_state_path"],
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
            manual_only=body.manual_only if body.manual_only is not None else bool(current["manual_only"]),
            login_url=body.login_url if body.login_url is not None else current["login_url"],
            storage_state_path=body.storage_state_path if body.storage_state_path is not None else current["storage_state_path"],
            woo_enabled=body.woo_enabled if body.woo_enabled is not None else bool(current["woo_enabled"]),
            woo_site_url=body.woo_site_url if body.woo_site_url is not None else current["woo_site_url"],
            woo_consumer_key=body.woo_consumer_key if body.woo_consumer_key is not None else current["woo_consumer_key"],
            woo_consumer_secret=body.woo_consumer_secret if body.woo_consumer_secret is not None else current["woo_consumer_secret"],
            woo_auto_import_new=body.woo_auto_import_new if body.woo_auto_import_new is not None else bool(current["woo_auto_import_new"]),
        )
        await db.execute(
            """UPDATE stores
               SET name = ?, base_url = ?, manual_only = ?, login_url = ?,
                   storage_state_path = ?, woo_enabled = ?, woo_site_url = ?,
                   woo_consumer_key = ?, woo_consumer_secret = ?,
                   woo_auto_import_new = ?
               WHERE id = ?""",
            (
                cleaned["name"],
                cleaned["base_url"],
                int(cleaned["manual_only"]),
                cleaned["login_url"],
                cleaned["storage_state_path"],
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


@router.post("/{store_id}/login-session", response_model=StoreLoginSessionResponse)
async def capture_login_session(store_id: int, body: StoreLoginSessionRequest):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Store not found")
        store = _row_to_store(rows[0])
    finally:
        await db.close()

    target_url = _login_target(store)
    save_path = f"stores/store-{store_id}-login.json"
    result = await save_login_state(
        url=target_url,
        save_path=save_path,
        headless=body.headless,
        wait_seconds=body.wait_seconds,
    )

    db = await get_db()
    try:
        await db.execute(
            """UPDATE stores
               SET storage_state_path = ?, session_updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (save_path, store_id),
        )
        await db.commit()
        refreshed = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        return StoreLoginSessionResponse(
            store=_row_to_store(refreshed[0]),
            saved_to=result["saved_to"],
            final_url=result["final_url"],
        )
    finally:
        await db.close()


@router.delete("/{store_id}/login-session", response_model=Store)
async def clear_login_session(store_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Store not found")
        current = rows[0]
        saved_path = current["storage_state_path"]
    finally:
        await db.close()

    resolved: Path | None = None
    if saved_path:
        try:
            resolved = resolve_storage_state_path(saved_path)
        except Exception:
            resolved = None

    if resolved and resolved.exists():
        try:
            resolved.unlink()
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Could not remove saved login session file: {exc}",
            )

    db = await get_db()
    try:
        await db.execute(
            """UPDATE stores
               SET storage_state_path = NULL,
                   session_updated_at = NULL
               WHERE id = ?""",
            (store_id,),
        )
        await db.commit()
        refreshed = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        return _row_to_store(refreshed[0])
    finally:
        await db.close()


@router.delete("/{store_id}/catalog")
async def clear_store_catalog(store_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Store not found")
        store = _row_to_store(rows[0])
        summary = await _clear_store_catalog_rows(db, store_id)
        await db.commit()
        return {
            "store_id": store.id,
            "store_name": store.name,
            **summary,
        }
    finally:
        await db.close()


@router.delete("/{store_id}", status_code=204)
async def delete_store(store_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(_STORE_SELECT + " WHERE id=?", (store_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Store not found")
        await _clear_store_catalog_rows(db, store_id)
        await db.execute("DELETE FROM stores WHERE id=?", (store_id,))
        await db.commit()
    finally:
        await db.close()

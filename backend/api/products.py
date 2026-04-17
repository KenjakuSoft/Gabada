import json
import logging
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database.db import get_db
from database.models import (
    Product, ProductCreate, ProductStoreCreate, ProductStoreSummary,
    ProductStoreOverride, ProductStoreOverrideUpsert,
    ScrapeConfig, ScrapeSelectors,
)
from scraper.engine import probe as probe_url, _PLATFORM_SELECTORS, _PLATFORM_WAIT_FOR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/products", tags=["products"])


def _selectors_are_empty(sel: ScrapeSelectors) -> bool:
    return not any([
        sel.title, sel.price, sel.discounted_price,
        sel.dealer_price, sel.stock_status, sel.image,
    ])


def _apply_platform_defaults(config: ScrapeConfig, platform: str) -> ScrapeConfig:
    """Fill wait_for + selectors from platform defaults, preserving any
    fields the caller already set."""
    plat = platform if platform in _PLATFORM_SELECTORS else "generic"
    defaults = _PLATFORM_SELECTORS[plat]
    sel = config.selectors
    merged_selectors = ScrapeSelectors(
        title=sel.title or defaults.get("title"),
        price=sel.price or defaults.get("price"),
        discounted_price=sel.discounted_price or defaults.get("discounted_price"),
        dealer_price=sel.dealer_price or defaults.get("dealer_price"),
        stock_status=sel.stock_status or defaults.get("stock_status"),
        image=sel.image,
    )
    wait_for = config.wait_for or _PLATFORM_WAIT_FOR.get(plat) or None
    return ScrapeConfig(
        use_playwright=config.use_playwright,
        wait_for=wait_for,
        wait_timeout=config.wait_timeout,
        selectors=merged_selectors,
        cookies=config.cookies,
        headers=config.headers,
        storage_state_path=config.storage_state_path,
        platform=plat,
    )


async def _auto_detect_config(url: str, config: ScrapeConfig) -> ScrapeConfig:
    """Run a probe on `url` and merge detected platform defaults into
    `config`. Probe failures fall back to the original config unchanged."""
    try:
        report = await probe_url(url, config)
        platform = report.platform or "generic"
        logger.info("Auto-detected platform %s for %s", platform, url)
        return _apply_platform_defaults(config, platform)
    except Exception as e:
        logger.warning("Auto-detect probe failed for %s: %s", url, e)
        return config

_PRODUCT_QUERY = """
    SELECT p.id, p.canonical_name, p.image_url, p.created_at,
           p.category_id, c.name AS category_name, c.color AS category_color
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
"""

def _row_to_product(r, stores) -> Product:
    return Product(
        id=r["id"],
        canonical_name=r["canonical_name"],
        image_url=r["image_url"],
        created_at=r["created_at"],
        category_id=r["category_id"],
        category_name=r["category_name"],
        category_color=r["category_color"],
        stores=stores,
    )


@router.get("/", response_model=list[Product])
async def list_products(category_id: Optional[int] = Query(None)):
    db = await get_db()
    try:
        if category_id is not None:
            rows = await db.execute_fetchall(
                _PRODUCT_QUERY + " WHERE p.category_id = ? ORDER BY p.canonical_name",
                (category_id,),
            )
        else:
            rows = await db.execute_fetchall(
                _PRODUCT_QUERY + " ORDER BY p.canonical_name"
            )
        products = []
        for row in rows:
            stores = await _get_store_summaries(db, row["id"])
            products.append(_row_to_product(row, stores))
        return products
    finally:
        await db.close()


@router.get("/{product_id}", response_model=Product)
async def get_product(product_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            _PRODUCT_QUERY + " WHERE p.id = ?", (product_id,)
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Product not found")
        stores = await _get_store_summaries(db, product_id)
        return _row_to_product(rows[0], stores)
    finally:
        await db.close()


@router.post("/", response_model=Product, status_code=201)
async def create_product(body: ProductCreate):
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO products (canonical_name, image_url, category_id) VALUES (?, ?, ?)",
            (body.canonical_name, body.image_url, body.category_id),
        )
        await db.commit()
        return await get_product(cur.lastrowid)
    finally:
        await db.close()


@router.patch("/{product_id}", response_model=Product)
async def update_product(product_id: int, body: ProductCreate):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE products SET canonical_name=?, image_url=?, category_id=? WHERE id=?",
            (body.canonical_name, body.image_url, body.category_id, product_id),
        )
        await db.commit()
        return await get_product(product_id)
    finally:
        await db.close()


@router.delete("/{product_id}", status_code=204)
async def delete_product(product_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM products WHERE id=?", (product_id,))
        await db.commit()
    finally:
        await db.close()


@router.post("/{product_id}/stores", response_model=ProductStoreSummary, status_code=201)
async def add_store_link(product_id: int, body: ProductStoreCreate):
    config = body.scrape_config
    # Auto-detect only when the caller hasn't supplied custom selectors
    # or a wait_for. Cookies/storage_state are preserved either way.
    if body.auto_detect and not config.wait_for and _selectors_are_empty(config.selectors):
        config = await _auto_detect_config(body.product_url, config)

    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO product_stores (product_id, store_id, product_url, scrape_config)
               VALUES (?, ?, ?, ?)""",
            (product_id, body.store_id, body.product_url, config.model_dump_json()),
        )
        await db.commit()
        ps_id = cur.lastrowid
        summaries = await _get_store_summaries(db, product_id)
        match = next((s for s in summaries if s.id == ps_id), None)
        if not match:
            raise HTTPException(status_code=500, detail="Could not retrieve created link")
        return match
    finally:
        await db.close()


@router.delete("/{product_id}/stores/{product_store_id}", status_code=204)
async def remove_store_link(product_id: int, product_store_id: int):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM product_stores WHERE id=? AND product_id=?",
            (product_store_id, product_id),
        )
        await db.commit()
    finally:
        await db.close()


async def _get_store_summaries(db, product_id: int) -> list[ProductStoreSummary]:
    rows = await db.execute_fetchall(
        """
        SELECT
            ps.id, ps.store_id, ps.product_url, ps.is_active,
            s.name AS store_name, s.base_url AS store_base_url,
            pl.price AS latest_price,
            pl.discounted_price AS latest_discounted_price,
            pl.dealer_price AS latest_dealer_price,
            pl.stock_status AS latest_stock_status,
            pl.scraped_at AS latest_scraped_at,
            pl.change_type AS latest_change_type,
            pl.price_delta AS latest_price_delta,
            pso.manual_price,
            pso.manual_stock_status,
            pso.override_note
        FROM product_stores ps
        JOIN stores s ON s.id = ps.store_id
        LEFT JOIN price_logs pl ON pl.id = (
            SELECT id FROM price_logs
            WHERE product_store_id = ps.id
            ORDER BY scraped_at DESC LIMIT 1
        )
        LEFT JOIN product_store_overrides pso ON pso.product_store_id = ps.id
        WHERE ps.product_id = ?
        ORDER BY s.name
        """,
        (product_id,),
    )
    return [
        ProductStoreSummary(
            id=r["id"],
            store_id=r["store_id"],
            store_name=r["store_name"],
            store_base_url=r["store_base_url"],
            product_url=r["product_url"],
            is_active=bool(r["is_active"]),
            latest_price=r["latest_price"],
            latest_discounted_price=r["latest_discounted_price"],
            latest_dealer_price=r["latest_dealer_price"],
            latest_stock_status=r["latest_stock_status"],
            latest_scraped_at=r["latest_scraped_at"],
            latest_change_type=r["latest_change_type"],
            latest_price_delta=r["latest_price_delta"],
            manual_price=r["manual_price"],
            manual_stock_status=r["manual_stock_status"],
            override_note=r["override_note"],
        )
        for r in rows
    ]


# ── Manual overrides ───────────────────────────────────────────────────────────

@router.get("/{product_id}/stores/{product_store_id}/override",
            response_model=ProductStoreOverride)
async def get_override(product_id: int, product_store_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM product_store_overrides WHERE product_store_id=?",
            (product_store_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="No override found")
        r = rows[0]
        return ProductStoreOverride(
            id=r["id"],
            product_store_id=r["product_store_id"],
            manual_price=r["manual_price"],
            manual_stock_status=r["manual_stock_status"],
            override_note=r["override_note"],
            updated_at=r["updated_at"],
        )
    finally:
        await db.close()


@router.put("/{product_id}/stores/{product_store_id}/override",
            response_model=ProductStoreOverride)
async def upsert_override(
    product_id: int, product_store_id: int, body: ProductStoreOverrideUpsert
):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO product_store_overrides
                   (product_store_id, manual_price, manual_stock_status, override_note)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(product_store_id) DO UPDATE SET
                   manual_price=excluded.manual_price,
                   manual_stock_status=excluded.manual_stock_status,
                   override_note=excluded.override_note,
                   updated_at=CURRENT_TIMESTAMP""",
            (product_store_id, body.manual_price, body.manual_stock_status, body.override_note),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_override(product_id, product_store_id)


@router.delete("/{product_id}/stores/{product_store_id}/override", status_code=204)
async def delete_override(product_id: int, product_store_id: int):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM product_store_overrides WHERE product_store_id=?",
            (product_store_id,),
        )
        await db.commit()
    finally:
        await db.close()

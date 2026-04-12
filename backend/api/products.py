import json
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database.db import get_db
from database.models import (
    Product, ProductCreate, ProductStoreCreate, ProductStoreSummary
)

router = APIRouter(prefix="/products", tags=["products"])

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
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO product_stores (product_id, store_id, product_url, scrape_config)
               VALUES (?, ?, ?, ?)""",
            (product_id, body.store_id, body.product_url, body.scrape_config.model_dump_json()),
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
            pl.stock_status AS latest_stock_status,
            pl.scraped_at AS latest_scraped_at,
            pl.change_type AS latest_change_type,
            pl.price_delta AS latest_price_delta
        FROM product_stores ps
        JOIN stores s ON s.id = ps.store_id
        LEFT JOIN price_logs pl ON pl.id = (
            SELECT id FROM price_logs
            WHERE product_store_id = ps.id
            ORDER BY scraped_at DESC LIMIT 1
        )
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
            latest_stock_status=r["latest_stock_status"],
            latest_scraped_at=r["latest_scraped_at"],
            latest_change_type=r["latest_change_type"],
            latest_price_delta=r["latest_price_delta"],
        )
        for r in rows
    ]

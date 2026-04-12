import json
from fastapi import APIRouter, HTTPException
from database.db import get_db
from database.models import (
    Product, ProductCreate, ProductStoreCreate, ProductStoreSummary
)

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/", response_model=list[Product])
async def list_products():
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, canonical_name, image_url, created_at FROM products ORDER BY canonical_name"
        )
        products = []
        for row in rows:
            stores = await _get_store_summaries(db, row["id"])
            products.append(Product(
                id=row["id"],
                canonical_name=row["canonical_name"],
                image_url=row["image_url"],
                created_at=row["created_at"],
                stores=stores,
            ))
        return products
    finally:
        await db.close()


@router.get("/{product_id}", response_model=Product)
async def get_product(product_id: int):
    db = await get_db()
    try:
        row = await db.execute_fetchall(
            "SELECT id, canonical_name, image_url, created_at FROM products WHERE id = ?",
            (product_id,),
        )
        if not row:
            raise HTTPException(status_code=404, detail="Product not found")
        r = row[0]
        stores = await _get_store_summaries(db, product_id)
        return Product(
            id=r["id"],
            canonical_name=r["canonical_name"],
            image_url=r["image_url"],
            created_at=r["created_at"],
            stores=stores,
        )
    finally:
        await db.close()


@router.post("/", response_model=Product, status_code=201)
async def create_product(body: ProductCreate):
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO products (canonical_name, image_url) VALUES (?, ?)",
            (body.canonical_name, body.image_url),
        )
        await db.commit()
        product_id = cur.lastrowid
        return await get_product(product_id)
    finally:
        await db.close()


@router.patch("/{product_id}", response_model=Product)
async def update_product(product_id: int, body: ProductCreate):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE products SET canonical_name=?, image_url=? WHERE id=?",
            (body.canonical_name, body.image_url, product_id),
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
            pl.scraped_at AS latest_scraped_at
        FROM product_stores ps
        JOIN stores s ON s.id = ps.store_id
        LEFT JOIN price_logs pl ON pl.id = (
            SELECT id FROM price_logs
            WHERE product_store_id = ps.id
            ORDER BY scraped_at DESC
            LIMIT 1
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
        )
        for r in rows
    ]

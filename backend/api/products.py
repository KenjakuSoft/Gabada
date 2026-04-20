import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.product_service import (
    auto_detect_config,
    create_product_record,
    create_store_link,
    fetch_product_or_404,
    fetch_products,
    get_store_summaries,
    quick_add_one,
    selectors_are_empty,
)
from database.db import get_db
from database.models import (
    Product,
    ProductCreate,
    ProductStoreCreate,
    ProductStoreOverride,
    ProductStoreOverrideUpsert,
    ProductStoreSummary,
    QuickAddRequest,
    QuickAddResponse,
    QuickAddResult,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/", response_model=list[Product])
async def list_products(category_id: Optional[int] = Query(None)):
    db = await get_db()
    try:
        return await fetch_products(db, category_id)
    finally:
        await db.close()


@router.get("/{product_id}", response_model=Product)
async def get_product(product_id: int):
    db = await get_db()
    try:
        return await fetch_product_or_404(db, product_id)
    finally:
        await db.close()


@router.post("/", response_model=Product, status_code=201)
async def create_product(body: ProductCreate):
    db = await get_db()
    try:
        product_id = await create_product_record(
            db,
            canonical_name=body.canonical_name,
            image_url=body.image_url,
            category_id=body.category_id,
        )
        await db.commit()
        return await fetch_product_or_404(db, product_id)
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
        return await fetch_product_or_404(db, product_id)
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
    if (
        body.auto_detect
        and not config.wait_for
        and selectors_are_empty(config.selectors)
    ):
        config = await auto_detect_config(body.product_url, config)

    db = await get_db()
    try:
        product_store_id = await create_store_link(
            db,
            product_id=product_id,
            store_id=body.store_id,
            product_url=body.product_url,
            scrape_config_json=config.model_dump_json(),
        )
        await db.commit()
        summaries = await get_store_summaries(db, product_id)
        match = next((summary for summary in summaries if summary.id == product_store_id), None)
        if match is None:
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


@router.get(
    "/{product_id}/stores/{product_store_id}/override",
    response_model=ProductStoreOverride,
)
async def get_override(product_id: int, product_store_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM product_store_overrides WHERE product_store_id=?",
            (product_store_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="No override found")
        row = rows[0]
        return ProductStoreOverride(
            id=row["id"],
            product_store_id=row["product_store_id"],
            manual_price=row["manual_price"],
            manual_stock_status=row["manual_stock_status"],
            override_note=row["override_note"],
            updated_at=row["updated_at"],
        )
    finally:
        await db.close()


@router.put(
    "/{product_id}/stores/{product_store_id}/override",
    response_model=ProductStoreOverride,
)
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
            (
                product_store_id,
                body.manual_price,
                body.manual_stock_status,
                body.override_note,
            ),
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


@router.post("/quick-add", response_model=QuickAddResponse)
async def quick_add(body: QuickAddRequest) -> QuickAddResponse:
    """
    Paste a list of product URLs, auto-detect everything, create tracked products.

    For each URL: hostname -> find-or-create store; probe -> platform, title,
    price, stock; create product + product_store link + initial price log.
    """
    seen: set[str] = set()
    urls: list[str] = []
    for raw in body.urls:
        url = (raw or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)

    if not urls:
        raise HTTPException(status_code=400, detail="No URLs provided")

    results: list[QuickAddResult] = []
    db = await get_db()
    try:
        for url in urls:
            try:
                results.append(
                    await quick_add_one(db, url=url, category_id=body.category_id)
                )
            except Exception as exc:
                logger.exception("quick-add failed for %s", url)
                results.append(
                    QuickAddResult(url=url, status="error", error=str(exc))
                )
    finally:
        await db.close()

    return QuickAddResponse(results=results)

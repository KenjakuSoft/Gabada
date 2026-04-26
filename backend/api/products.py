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
    ProductStoreUpdate,
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
    provided_url = (body.product_url or "").strip()
    config = body.scrape_config

    db = await get_db()
    try:
        store_rows = await db.execute_fetchall(
            """SELECT manual_only, storage_state_path
               FROM stores
               WHERE id = ?""",
            (body.store_id,),
        )
        if not store_rows:
            raise HTTPException(status_code=404, detail="Store not found")

        store_row = store_rows[0]
        manual_only = bool(store_row["manual_only"])
        if not config.storage_state_path and store_row["storage_state_path"]:
            config.storage_state_path = store_row["storage_state_path"]

        if not provided_url:
            if not manual_only:
                raise HTTPException(status_code=400, detail="Product URL is required for website-backed stores")
            provided_url = f"manual://store-{body.store_id}/product-{product_id}"

        has_real_url = provided_url.startswith(("http://", "https://"))
        if (
            body.auto_detect
            and has_real_url
            and not config.wait_for
            and selectors_are_empty(config.selectors)
        ):
            config = await auto_detect_config(provided_url, config)

        product_store_id = await create_store_link(
            db,
            product_id=product_id,
            store_id=body.store_id,
            product_url=provided_url,
            scrape_config_json=config.model_dump_json(),
            is_active=has_real_url,
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


@router.patch(
    "/{product_id}/stores/{product_store_id}",
    response_model=ProductStoreSummary,
)
async def update_store_link(
    product_id: int,
    product_store_id: int,
    body: ProductStoreUpdate,
):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT
                   ps.id,
                   ps.store_id,
                   ps.product_url,
                   ps.is_active,
                   s.manual_only
               FROM product_stores ps
               JOIN stores s ON s.id = ps.store_id
               WHERE ps.id = ? AND ps.product_id = ?
               LIMIT 1""",
            (product_store_id, product_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Store link not found")

        link_row = rows[0]
        fields_set = set(body.model_fields_set)

        if "product_url" in fields_set:
            next_url = (body.product_url or "").strip()
            if bool(link_row["manual_only"]):
                if not next_url:
                    next_url = f"manual://store-{link_row['store_id']}/product-{product_id}"
            elif not next_url:
                raise HTTPException(
                    status_code=400,
                    detail="Product URL is required for website-backed stores",
                )

            next_is_active = int(next_url.startswith(("http://", "https://")))
            if not bool(link_row["manual_only"]) and next_is_active == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Website-backed stores need an http(s) product URL",
                )

            await db.execute(
                """UPDATE product_stores
                   SET product_url = ?, is_active = ?
                   WHERE id = ? AND product_id = ?""",
                (next_url, next_is_active, product_store_id, product_id),
            )

        override_fields = {
            "manual_price",
            "manual_stock_status",
            "manual_warranty",
            "override_note",
        } & fields_set
        if override_fields:
            override_rows = await db.execute_fetchall(
                """SELECT
                       manual_price,
                       manual_stock_status,
                       manual_warranty,
                       imported_dealer_price,
                       imported_warranty,
                       override_note
                   FROM product_store_overrides
                   WHERE product_store_id = ?
                   LIMIT 1""",
                (product_store_id,),
            )
            current_override = override_rows[0] if override_rows else None

            next_manual_price = (
                body.manual_price
                if "manual_price" in override_fields
                else (current_override["manual_price"] if current_override else None)
            )
            next_manual_stock_status = (
                (body.manual_stock_status or None)
                if "manual_stock_status" in override_fields
                else (current_override["manual_stock_status"] if current_override else None)
            )
            next_manual_warranty = (
                ((body.manual_warranty or "").strip() or None)
                if "manual_warranty" in override_fields
                else (current_override["manual_warranty"] if current_override else None)
            )
            next_override_note = (
                ((body.override_note or "").strip() or None)
                if "override_note" in override_fields
                else (current_override["override_note"] if current_override else None)
            )

            if (
                next_manual_price is None
                and next_manual_stock_status is None
                and next_manual_warranty is None
                and next_override_note is None
            ):
                has_import_fallback = bool(
                    current_override
                    and (
                        current_override["imported_dealer_price"] is not None
                        or (current_override["imported_warranty"] or "").strip()
                    )
                )
                if has_import_fallback:
                    await db.execute(
                        """UPDATE product_store_overrides
                           SET manual_price = NULL,
                               manual_stock_status = NULL,
                               manual_warranty = NULL,
                               override_note = NULL,
                               updated_at = CURRENT_TIMESTAMP
                           WHERE product_store_id = ?""",
                        (product_store_id,),
                    )
                else:
                    await db.execute(
                        "DELETE FROM product_store_overrides WHERE product_store_id = ?",
                        (product_store_id,),
                    )
            else:
                await db.execute(
                    """INSERT INTO product_store_overrides
                           (product_store_id, manual_price, manual_stock_status, manual_warranty, override_note)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(product_store_id) DO UPDATE SET
                           manual_price = excluded.manual_price,
                           manual_stock_status = excluded.manual_stock_status,
                           manual_warranty = excluded.manual_warranty,
                           override_note = excluded.override_note,
                           updated_at = CURRENT_TIMESTAMP""",
                    (
                        product_store_id,
                        next_manual_price,
                        next_manual_stock_status,
                        next_manual_warranty,
                        next_override_note,
                    ),
                )

        await db.commit()
        summaries = await get_store_summaries(db, product_id)
        match = next((summary for summary in summaries if summary.id == product_store_id), None)
        if match is None:
            raise HTTPException(status_code=500, detail="Could not retrieve updated store link")
        return match
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
            manual_warranty=row["manual_warranty"],
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
                   (product_store_id, manual_price, manual_stock_status, manual_warranty, override_note)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(product_store_id) DO UPDATE SET
                   manual_price=excluded.manual_price,
                   manual_stock_status=excluded.manual_stock_status,
                   manual_warranty=excluded.manual_warranty,
                   override_note=excluded.override_note,
                   updated_at=CURRENT_TIMESTAMP""",
            (
                product_store_id,
                body.manual_price,
                body.manual_stock_status,
                body.manual_warranty,
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
        rows = await db.execute_fetchall(
            """SELECT imported_dealer_price, imported_warranty
               FROM product_store_overrides
               WHERE product_store_id = ?
               LIMIT 1""",
            (product_store_id,),
        )
        if rows and (
            rows[0]["imported_dealer_price"] is not None
            or (rows[0]["imported_warranty"] or "").strip()
        ):
            await db.execute(
                """UPDATE product_store_overrides
                   SET manual_price = NULL,
                       manual_stock_status = NULL,
                       manual_warranty = NULL,
                       override_note = NULL,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE product_store_id = ?""",
                (product_store_id,),
            )
        else:
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

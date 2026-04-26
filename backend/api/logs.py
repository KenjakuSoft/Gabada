from fastapi import APIRouter, Query
from typing import Optional
from datetime import date
from database.db import get_db
from database.models import PriceLog

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("/", response_model=list[PriceLog])
async def get_logs(
    product_store_id: int,
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    limit: int = Query(365, le=1000),
):
    db = await get_db()
    try:
        conditions = ["product_store_id = ?"]
        params: list = [product_store_id]

        if from_date:
            conditions.append("DATE(scraped_at) >= ?")
            params.append(str(from_date))
        if to_date:
            conditions.append("DATE(scraped_at) <= ?")
            params.append(str(to_date))

        where = " AND ".join(conditions)
        rows = await db.execute_fetchall(
            f"""SELECT id, product_store_id, scraped_at, title, price,
                       discounted_price, dealer_price, warranty, stock_status,
                       change_type, price_delta, previous_price,
                       previous_stock_status
                FROM price_logs
                WHERE {where}
                ORDER BY scraped_at DESC
                LIMIT ?""",
            (*params, limit),
        )
        return [PriceLog(**dict(r)) for r in rows]
    finally:
        await db.close()


@router.get("/product/{product_id}", response_model=list[PriceLog])
async def get_logs_for_product(
    product_id: int,
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    limit: int = Query(1000, le=5000),
):
    """All logs for every store carrying this product — useful for chart overlays."""
    db = await get_db()
    try:
        conditions = ["ps.product_id = ?"]
        params: list = [product_id]

        if from_date:
            conditions.append("DATE(pl.scraped_at) >= ?")
            params.append(str(from_date))
        if to_date:
            conditions.append("DATE(pl.scraped_at) <= ?")
            params.append(str(to_date))

        where = " AND ".join(conditions)
        rows = await db.execute_fetchall(
            f"""SELECT pl.id, pl.product_store_id, pl.scraped_at, pl.title,
                       pl.price, pl.discounted_price, pl.dealer_price,
                       pl.warranty, pl.stock_status, pl.change_type,
                       pl.price_delta, pl.previous_price,
                       pl.previous_stock_status
                FROM price_logs pl
                JOIN product_stores ps ON ps.id = pl.product_store_id
                WHERE {where}
                ORDER BY pl.scraped_at DESC
                LIMIT ?""",
            (*params, limit),
        )
        return [PriceLog(**dict(r)) for r in rows]
    finally:
        await db.close()

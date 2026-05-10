from typing import Optional
from fastapi import APIRouter, Query
from database.db import get_db
from database.models import ActivityEntry

router = APIRouter(prefix="/activity", tags=["activity"])

_ACTIVITY_QUERY = """
    SELECT
        pl.id,
        p.id          AS product_id,
        p.canonical_name AS product_name,
        s.id          AS store_id,
        s.name        AS store_name,
        pl.change_type,
        pl.price,
        pl.discounted_price,
        pl.dealer_price,
        pl.raw_price,
        pl.raw_discounted,
        pl.raw_dealer,
        pl.currency_code,
        pl.price_delta,
        pl.previous_price,
        pl.stock_status,
        pl.previous_stock_status,
        pl.scraped_at
    FROM price_logs pl
    JOIN product_stores ps ON ps.id = pl.product_store_id
    JOIN products p        ON p.id  = ps.product_id
    JOIN stores s          ON s.id  = ps.store_id
    WHERE pl.change_type IS NOT NULL
      AND pl.change_type != 'no_change'
"""


@router.get("/", response_model=list[ActivityEntry])
async def get_activity(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    change_type: Optional[str] = Query(default=None),
):
    """Return recent meaningful price/stock changes, newest first."""
    db = await get_db()
    try:
        query = _ACTIVITY_QUERY
        params: list = []

        if change_type:
            query += " AND pl.change_type = ?"
            params.append(change_type)

        query += " ORDER BY pl.scraped_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = await db.execute_fetchall(query, params)
        return [ActivityEntry(**dict(r)) for r in rows]
    finally:
        await db.close()

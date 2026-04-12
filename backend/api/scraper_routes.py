import json
import logging
from typing import Optional, Tuple
from fastapi import APIRouter, BackgroundTasks
from database.db import get_db
from database.models import ScrapeConfig, ScrapeResult
from scraper.engine import scrape

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scraper", tags=["scraper"])


def _effective_price(price: Optional[float], disc: Optional[float]) -> Optional[float]:
    return disc if disc is not None else price


async def _compute_change(
    db, product_store_id: int, result: ScrapeResult
) -> Tuple[str, Optional[float], Optional[float], Optional[str]]:
    """Return (change_type, price_delta, previous_price, previous_stock_status)."""
    rows = await db.execute_fetchall(
        """SELECT price, discounted_price, stock_status
           FROM price_logs
           WHERE product_store_id = ?
           ORDER BY scraped_at DESC LIMIT 1""",
        (product_store_id,),
    )

    if not rows:
        return "new", None, None, None

    prev = rows[0]
    prev_eff = _effective_price(prev["price"], prev["discounted_price"])
    new_eff = _effective_price(result.price, result.discounted_price)
    prev_stock = prev["stock_status"] or "unknown"
    new_stock = result.stock_status or "unknown"

    price_changed = False
    price_delta: Optional[float] = None

    if prev_eff is not None and new_eff is not None:
        delta = new_eff - prev_eff
        if abs(delta) > 0.001:
            price_delta = round(delta, 2)
            price_changed = True
    elif prev_eff is None and new_eff is not None:
        price_changed = True  # price data appeared; delta stays None

    stock_changed = prev_stock != new_stock

    if price_changed and stock_changed:
        change_type = "price_and_stock"
    elif price_changed:
        if price_delta is not None:
            change_type = "price_up" if price_delta > 0 else "price_down"
        else:
            change_type = "price_up"
    elif stock_changed:
        if new_stock == "out_of_stock":
            change_type = "stock_out"
        elif new_stock in ("in_stock", "limited"):
            change_type = "stock_in"
        else:
            change_type = "stock_change"
    else:
        change_type = "no_change"

    return change_type, price_delta, prev_eff, prev_stock


async def _do_scrape(product_store_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT ps.product_url, ps.scrape_config
               FROM product_stores ps
               WHERE ps.id = ? AND ps.is_active = 1""",
            (product_store_id,),
        )
        if not rows:
            logger.warning("product_store_id %d not found or inactive", product_store_id)
            return

        row = rows[0]
        config_dict = json.loads(row["scrape_config"] or "{}")
        config = ScrapeConfig(**config_dict)

        result = await scrape(row["product_url"], config)

        if result.error:
            logger.error("Scrape error for ps_id=%d: %s", product_store_id, result.error)
            return

        change_type, price_delta, previous_price, previous_stock_status = \
            await _compute_change(db, product_store_id, result)

        await db.execute(
            """INSERT INTO price_logs
               (product_store_id, title, price, discounted_price, stock_status,
                raw_price, raw_discounted,
                change_type, price_delta, previous_price, previous_stock_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                product_store_id,
                result.title,
                result.price,
                result.discounted_price,
                result.stock_status,
                result.raw_price,
                result.raw_discounted,
                change_type,
                price_delta,
                previous_price,
                previous_stock_status,
            ),
        )
        await db.commit()
        logger.info(
            "Scraped ps_id=%d → price=%s stock=%s change=%s delta=%s",
            product_store_id, result.price, result.stock_status, change_type, price_delta,
        )
    finally:
        await db.close()


async def scrape_all_active():
    """Called by the scheduler. Scrapes every active product_store."""
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id FROM product_stores WHERE is_active = 1"
        )
        ids = [r["id"] for r in rows]
    finally:
        await db.close()

    for ps_id in ids:
        try:
            await _do_scrape(ps_id)
        except Exception as e:
            logger.error("Failed scraping ps_id=%d: %s", ps_id, e)


@router.post("/scrape/{product_store_id}", status_code=202)
async def manual_scrape(product_store_id: int, background_tasks: BackgroundTasks):
    """Trigger an immediate scrape for a single product_store in the background."""
    background_tasks.add_task(_do_scrape, product_store_id)
    return {"status": "queued", "product_store_id": product_store_id}


@router.post("/scrape-all", status_code=202)
async def manual_scrape_all(background_tasks: BackgroundTasks):
    """Trigger an immediate scrape for all active product_stores."""
    background_tasks.add_task(scrape_all_active)
    return {"status": "queued"}

import json
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks
from database.db import get_db
from database.models import ScrapeConfig, ScrapeResult
from scraper.engine import scrape

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scraper", tags=["scraper"])


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

        await db.execute(
            """INSERT INTO price_logs
               (product_store_id, title, price, discounted_price, stock_status, raw_price, raw_discounted)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                product_store_id,
                result.title,
                result.price,
                result.discounted_price,
                result.stock_status,
                result.raw_price,
                result.raw_discounted,
            ),
        )
        await db.commit()
        logger.info("Scraped ps_id=%d → price=%s stock=%s", product_store_id, result.price, result.stock_status)
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

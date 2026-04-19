import json
import logging
from typing import Optional, Tuple
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from database.db import get_db
from database.models import (
    ScrapeConfig,
    ScrapeResult,
    ProbeRequest,
    ProbeResponse,
    LoginSessionRequest,
)
from scraper.engine import scrape, probe, save_login_state
from scraper import site_profiles

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
               (product_store_id, title, price, discounted_price, dealer_price,
                stock_status, raw_price, raw_discounted, raw_dealer,
                change_type, price_delta, previous_price, previous_stock_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                product_store_id,
                result.title,
                result.price,
                result.discounted_price,
                result.dealer_price,
                result.stock_status,
                result.raw_price,
                result.raw_discounted,
                result.raw_dealer,
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


@router.post("/probe", response_model=ProbeResponse)
async def probe_url(request: ProbeRequest) -> ProbeResponse:
    """
    Deep-dive diagnostics for an arbitrary URL.

    Runs the full scraper waterfall and returns the detected platform,
    raw candidates, suggested selectors, and a snapshot of what would be
    extracted right now. Use this to debug why a site scrapes incorrectly
    before wiring it up as a product_store.
    """
    config = ScrapeConfig(
        use_playwright=request.use_playwright,
        wait_for=request.wait_for,
        wait_timeout=request.wait_timeout,
        cookies=request.cookies,
        headers=request.headers,
        storage_state_path=request.storage_state_path,
    )
    try:
        return await probe(request.url, config)
    except Exception as e:
        logger.error("Probe endpoint failed for %s: %s", request.url, e)
        raise HTTPException(status_code=500, detail=f"Probe failed: {e}")


@router.post("/reprobe/{product_store_id}")
async def reprobe_store(product_store_id: int) -> dict:
    """
    Re-run probe on an existing product_store and patch its scrape_config
    with fresh platform-detected selectors. Preserves cookies,
    storage_state_path, and any custom selectors the user has set. Use this
    after a site redesign or when scrapes start returning nulls.
    """
    # Local imports to avoid circular deps with api.products at module load.
    from api.products import _apply_platform_defaults, _selectors_are_empty
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT product_url, scrape_config FROM product_stores WHERE id=?",
            (product_store_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="product_store not found")
        row = rows[0]
        config = ScrapeConfig(**json.loads(row["scrape_config"] or "{}"))
        try:
            report = await probe(row["product_url"], config)
        except Exception as e:
            logger.error("Reprobe failed for ps_id=%d: %s", product_store_id, e)
            raise HTTPException(status_code=500, detail=f"Probe failed: {e}")

        merged = _apply_platform_defaults(config, report.platform or "generic")
        await db.execute(
            "UPDATE product_stores SET scrape_config=? WHERE id=?",
            (merged.model_dump_json(), product_store_id),
        )
        await db.commit()
        return {
            "status": "ok",
            "product_store_id": product_store_id,
            "platform": report.platform,
            "wait_for": merged.wait_for,
            "selectors": merged.selectors.model_dump(),
            "extracted": report.extracted.model_dump(),
            "notes": report.notes,
        }
    finally:
        await db.close()


class SiteProfilesPayload(BaseModel):
    content: str


class SiteProfilesResponse(BaseModel):
    content: str
    path: str
    hostnames: list[str]


@router.get("/sites-config", response_model=SiteProfilesResponse)
async def get_sites_config() -> SiteProfilesResponse:
    """Return the raw text of ``sites.toml`` plus the active hostnames."""
    return SiteProfilesResponse(
        content=site_profiles.read_file(),
        path=site_profiles.SITES_TOML_PATH,
        hostnames=site_profiles.list_hostnames(),
    )


@router.put("/sites-config", response_model=SiteProfilesResponse)
async def put_sites_config(body: SiteProfilesPayload) -> SiteProfilesResponse:
    """
    Overwrite ``sites.toml`` with new content. Rejects invalid TOML so a bad
    edit never silently breaks scraping. The file lives on disk, so you can
    also edit it in Notepad — this endpoint just exists for the web UI.
    """
    try:
        site_profiles.write_file(body.content)
    except Exception as e:
        logger.warning("Rejected invalid sites.toml: %s", e)
        raise HTTPException(status_code=400, detail=f"Invalid TOML: {e}")
    return SiteProfilesResponse(
        content=site_profiles.read_file(),
        path=site_profiles.SITES_TOML_PATH,
        hostnames=site_profiles.list_hostnames(),
    )


@router.post("/login-session")
async def create_login_session(request: LoginSessionRequest) -> dict:
    """
    Open a non-headless Chromium window so the user can log in manually,
    then persist the session (cookies + localStorage) to disk as a
    Playwright `storage_state.json`. Point a product_store's
    `scrape_config.storage_state_path` at the saved file to scrape
    behind-login prices (e.g. dealer pricing).
    """
    try:
        result = await save_login_state(
            url=request.url,
            save_path=request.save_path,
            headless=request.headless,
            wait_seconds=request.wait_seconds,
        )
        return {"status": "ok", **result}
    except Exception as e:
        logger.error("login-session failed for %s: %s", request.url, e)
        raise HTTPException(status_code=500, detail=f"Login session failed: {e}")

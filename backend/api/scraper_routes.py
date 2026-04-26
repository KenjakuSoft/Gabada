import json
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from database.db import get_db
from database.models import (
    LoginSessionRequest,
    ProbeRequest,
    ProbeResponse,
    ScrapeConfig,
    ScrapeSelectors,
    ScrapeResult,
    SelectorLabProfile,
    SelectorLabRequest,
    SelectorLabResponse,
    SelectorLabSaveRequest,
    SelectorLabSaveResponse,
    SelectorLabTestRequest,
)
from scraper import site_profiles
from scraper.engine import inspect_selectors, probe, save_login_state, scrape
from scraper.site_profiles import apply_platform_defaults

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scraper", tags=["scraper"])

_SELECTOR_FIELDS = (
    "title",
    "price",
    "discounted_price",
    "dealer_price",
    "stock_status",
    "image",
)


def _effective_price(
    price: Optional[float], discounted_price: Optional[float]
) -> Optional[float]:
    return discounted_price if discounted_price is not None else price


async def _compute_change(
    db, product_store_id: int, result: ScrapeResult
) -> tuple[str, Optional[float], Optional[float], Optional[str]]:
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

    previous = rows[0]
    previous_effective = _effective_price(
        previous["price"], previous["discounted_price"]
    )
    current_effective = _effective_price(result.price, result.discounted_price)
    previous_stock = previous["stock_status"] or "unknown"
    current_stock = result.stock_status or "unknown"

    price_changed = False
    price_delta: Optional[float] = None

    if previous_effective is not None and current_effective is not None:
        delta = current_effective - previous_effective
        if abs(delta) > 0.001:
            price_delta = round(delta, 2)
            price_changed = True
    elif previous_effective is None and current_effective is not None:
        price_changed = True

    stock_changed = previous_stock != current_stock

    if price_changed and stock_changed:
        change_type = "price_and_stock"
    elif price_changed:
        if price_delta is not None:
            change_type = "price_up" if price_delta > 0 else "price_down"
        else:
            change_type = "price_up"
    elif stock_changed:
        if current_stock == "out_of_stock":
            change_type = "stock_out"
        elif current_stock in ("in_stock", "limited"):
            change_type = "stock_in"
        else:
            change_type = "stock_change"
    else:
        change_type = "no_change"

    return change_type, price_delta, previous_effective, previous_stock


async def _do_scrape(product_store_id: int):
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT ps.product_url, ps.scrape_config, s.manual_only, s.storage_state_path
               FROM product_stores ps
               JOIN stores s ON s.id = ps.store_id
               WHERE ps.id = ? AND ps.is_active = 1""",
            (product_store_id,),
        )
        if not rows:
            logger.warning("product_store_id %d not found or inactive", product_store_id)
            return

        row = rows[0]
        if bool(row["manual_only"]):
            logger.info("Skipping scrape for manual-only store link ps_id=%d", product_store_id)
            return
        config = ScrapeConfig(**json.loads(row["scrape_config"] or "{}"))
        if not config.storage_state_path and row["storage_state_path"]:
            config.storage_state_path = row["storage_state_path"]
        result = await scrape(row["product_url"], config)

        if result.error:
            logger.error("Scrape error for ps_id=%d: %s", product_store_id, result.error)
            return

        change_type, price_delta, previous_price, previous_stock_status = (
            await _compute_change(db, product_store_id, result)
        )

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
            "Scraped ps_id=%d -> price=%s stock=%s change=%s delta=%s",
            product_store_id,
            result.price,
            result.stock_status,
            change_type,
            price_delta,
        )
    finally:
        await db.close()


async def scrape_all_active():
    """Called by the scheduler. Scrapes every active product_store."""
    try:
        from api.import_routes import sync_all_enabled_woo_stores

        await sync_all_enabled_woo_stores()
    except Exception as exc:
        logger.error("Failed syncing Woo stores before scrape-all: %s", exc)

    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id FROM product_stores WHERE is_active = 1"
        )
        ids = [row["id"] for row in rows]
    finally:
        await db.close()

    for product_store_id in ids:
        try:
            await _do_scrape(product_store_id)
        except Exception as exc:
            logger.error("Failed scraping ps_id=%d: %s", product_store_id, exc)


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
    config, session_note = await _diagnostic_config(request)
    try:
        response = await probe(request.url, config)
        if session_note:
            response.notes.insert(0, session_note)
        return response
    except Exception as exc:
        logger.error("Probe endpoint failed for %s: %s", request.url, exc)
        raise HTTPException(status_code=500, detail=f"Probe failed: {exc}")


def _config_from_selector_body(
    body: SelectorLabRequest,
    selectors: Optional[dict[str, Optional[str]]] = None,
    platform: Optional[str] = None,
) -> ScrapeConfig:
    selector_values = selectors or {}
    return ScrapeConfig(
        use_playwright=body.use_playwright,
        wait_for=body.wait_for,
        wait_timeout=body.wait_timeout,
        cookies=body.cookies,
        headers=body.headers,
        storage_state_path=body.storage_state_path,
        platform=platform,
        selectors=ScrapeSelectors(
            title=selector_values.get("title"),
            price=selector_values.get("price"),
            discounted_price=selector_values.get("discounted_price"),
            dealer_price=selector_values.get("dealer_price"),
            stock_status=selector_values.get("stock_status"),
            image=selector_values.get("image"),
        ),
    )


async def _resolve_saved_store_session(url: str) -> tuple[Optional[str], Optional[str]]:
    hostname = site_profiles.normalize_hostname(url)
    if not hostname:
        return None, None

    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT name, base_url, storage_state_path
               FROM stores
               WHERE storage_state_path IS NOT NULL
               ORDER BY session_updated_at IS NULL, session_updated_at DESC, id DESC"""
        )
    finally:
        await db.close()

    for row in rows:
        if site_profiles.normalize_hostname(row["base_url"]) == hostname:
            return row["storage_state_path"], row["name"]
    return None, None


async def _diagnostic_config(
    body: ProbeRequest | SelectorLabRequest,
    selectors: Optional[dict[str, Optional[str]]] = None,
    platform: Optional[str] = None,
) -> tuple[ScrapeConfig, Optional[str]]:
    if isinstance(body, ProbeRequest):
        config = ScrapeConfig(
            use_playwright=body.use_playwright,
            wait_for=body.wait_for,
            wait_timeout=body.wait_timeout,
            cookies=body.cookies,
            headers=body.headers,
            storage_state_path=body.storage_state_path,
        )
    else:
        config = _config_from_selector_body(body, selectors=selectors, platform=platform)

    if config.storage_state_path:
        return config, None

    storage_state_path, store_name = await _resolve_saved_store_session(body.url)
    if not storage_state_path:
        return config, None

    config.storage_state_path = storage_state_path
    return config, f"Using saved dealer session from {store_name}."


def _profile_response(profile: site_profiles.SiteProfile) -> SelectorLabProfile:
    return SelectorLabProfile(
        hostname=profile.hostname,
        matched_hostname=profile.hostname,
        platform=profile.platform,
        wait_for=profile.wait_for,
        selectors={field: profile.selectors.get(field) for field in _SELECTOR_FIELDS},
    )


async def _resolve_profile_hostname(
    db,
    body: SelectorLabSaveRequest,
) -> str:
    if body.hostname:
        hostname = site_profiles.normalize_hostname(body.hostname)
        if hostname:
            return hostname
    if body.store_id is not None:
        rows = await db.execute_fetchall(
            "SELECT base_url FROM stores WHERE id=?",
            (body.store_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="store not found")
        hostname = site_profiles.normalize_hostname(rows[0]["base_url"])
        if hostname:
            return hostname
    if body.url:
        hostname = site_profiles.normalize_hostname(body.url)
        if hostname:
            return hostname
    raise HTTPException(status_code=400, detail="Could not resolve a hostname")


@router.post("/selector-lab", response_model=SelectorLabResponse)
async def selector_lab(request: SelectorLabRequest) -> SelectorLabResponse:
    """Inspect a product page and return selector candidates for manual mapping."""
    try:
        config, session_note = await _diagnostic_config(request)
        response = await inspect_selectors(request.url, config)
        if session_note:
            response.notes.insert(0, session_note)
        return response
    except Exception as exc:
        logger.error("Selector lab failed for %s: %s", request.url, exc)
        raise HTTPException(status_code=500, detail=f"Selector lab failed: {exc}")


@router.post("/selector-lab/test", response_model=ScrapeResult)
async def selector_lab_test(request: SelectorLabTestRequest) -> ScrapeResult:
    """Run a scrape using the Selector Lab's currently selected fields."""
    try:
        config, _ = await _diagnostic_config(
            request,
            selectors=request.selectors,
            platform=request.platform,
        )
        return await scrape(request.url, config)
    except Exception as exc:
        logger.error("Selector lab test failed for %s: %s", request.url, exc)
        raise HTTPException(
            status_code=500,
            detail=f"Selector lab test failed: {exc}",
        )


@router.put("/selector-lab/profile", response_model=SelectorLabSaveResponse)
async def selector_lab_save_profile(
    body: SelectorLabSaveRequest,
) -> SelectorLabSaveResponse:
    """Save the selected selectors as the default profile for a store hostname."""
    db = await get_db()
    try:
        hostname = await _resolve_profile_hostname(db, body)
        current = site_profiles.get_exact_profile(hostname)
        merged_selectors = {
            field: (
                body.selectors[field]
                if field in body.selectors
                else (current.selectors.get(field) if current else None)
            )
            for field in _SELECTOR_FIELDS
        }
        profile = site_profiles.upsert_profile(
            hostname,
            platform=body.platform if body.platform is not None else (current.platform if current else None),
            wait_for=body.wait_for if body.wait_for is not None else (current.wait_for if current else None),
            selectors=merged_selectors,
            headers=current.headers if current else None,
        )
        return SelectorLabSaveResponse(
            profile=_profile_response(profile),
            path=site_profiles.SITES_TOML_PATH,
            hostnames=site_profiles.list_hostnames(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Selector lab save failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save selector profile: {exc}",
        )
    finally:
        await db.close()


@router.post("/reprobe/{product_store_id}")
async def reprobe_store(product_store_id: int) -> dict:
    """
    Re-run probe on an existing product_store and patch its scrape_config
    with fresh platform-detected selectors. Preserves cookies,
    storage_state_path, and any custom selectors the user has set. Use this
    after a site redesign or when scrapes start returning nulls.
    """
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT ps.product_url, ps.scrape_config, s.manual_only, s.storage_state_path
               FROM product_stores ps
               JOIN stores s ON s.id = ps.store_id
               WHERE ps.id=?""",
            (product_store_id,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="product_store not found")

        row = rows[0]
        if bool(row["manual_only"]):
            raise HTTPException(status_code=400, detail="Manual-only store links cannot be reprobed")
        config = ScrapeConfig(**json.loads(row["scrape_config"] or "{}"))
        if not config.storage_state_path and row["storage_state_path"]:
            config.storage_state_path = row["storage_state_path"]
        try:
            report = await probe(row["product_url"], config)
        except Exception as exc:
            logger.error("Reprobe failed for ps_id=%d: %s", product_store_id, exc)
            raise HTTPException(status_code=500, detail=f"Probe failed: {exc}")

        merged = apply_platform_defaults(config, report.platform or "generic")
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
    also edit it in Notepad - this endpoint just exists for the web UI.
    """
    try:
        site_profiles.write_file(body.content)
    except Exception as exc:
        logger.warning("Rejected invalid sites.toml: %s", exc)
        raise HTTPException(status_code=400, detail=f"Invalid TOML: {exc}")
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
    except Exception as exc:
        logger.error("login-session failed for %s: %s", request.url, exc)
        raise HTTPException(status_code=500, detail=f"Login session failed: {exc}")

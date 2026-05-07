import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database.db import get_db
from database.models import (
    BuyAreaPickRequest,
    BuyAreaPicksResponse,
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
from api.price_log_utils import get_settings_currency, infer_currency_code
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


ScrapeRunSummary = dict[str, object]


def _effective_price(
    price: Optional[float], discounted_price: Optional[float]
) -> Optional[float]:
    return discounted_price if discounted_price is not None else price


def _has_any_price(result: ScrapeResult) -> bool:
    return (
        result.price is not None
        or result.discounted_price is not None
        or result.dealer_price is not None
    )


async def _latest_price_row(db, product_store_id: int):
    rows = await db.execute_fetchall(
        """SELECT title, price, discounted_price, dealer_price,
                  raw_price, raw_discounted, raw_dealer, currency_code
           FROM price_logs
           WHERE product_store_id = ?
             AND (
                 price IS NOT NULL
                 OR discounted_price IS NOT NULL
                 OR dealer_price IS NOT NULL
                 OR NULLIF(TRIM(raw_price), '') IS NOT NULL
                 OR NULLIF(TRIM(raw_discounted), '') IS NOT NULL
                 OR NULLIF(TRIM(raw_dealer), '') IS NOT NULL
             )
           ORDER BY scraped_at DESC, id DESC
           LIMIT 1""",
        (product_store_id,),
    )
    return rows[0] if rows else None


async def _compute_change(
    db, product_store_id: int, result: ScrapeResult
) -> tuple[str, Optional[float], Optional[float], Optional[str]]:
    """Return (change_type, price_delta, previous_price, previous_stock_status)."""
    rows = await db.execute_fetchall(
        """SELECT price, discounted_price, stock_status
           FROM price_logs
           WHERE product_store_id = ?
           ORDER BY scraped_at DESC, id DESC LIMIT 1""",
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


async def _do_scrape(product_store_id: int) -> ScrapeRunSummary:
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT
                   ps.product_url,
                   ps.scrape_config,
                   s.manual_only,
                   s.storage_state_path,
                   s.api_enabled,
                   s.api_platform
               FROM product_stores ps
               JOIN stores s ON s.id = ps.store_id
               WHERE ps.id = ? AND ps.is_active = 1""",
            (product_store_id,),
        )
        if not rows:
            logger.warning("product_store_id %d not found or inactive", product_store_id)
            return {
                "status": "not_found",
                "product_store_id": product_store_id,
                "error": "Product store not found or inactive",
            }

        row = rows[0]
        if bool(row["manual_only"]):
            logger.info("Skipping scrape for manual-only store link ps_id=%d", product_store_id)
            return {
                "status": "skipped",
                "product_store_id": product_store_id,
                "reason": "manual_only",
            }
        if bool(row["api_enabled"]) and row["api_platform"]:
            from api.import_routes import sync_api_product_store

            return await sync_api_product_store(product_store_id)
        config = ScrapeConfig(**json.loads(row["scrape_config"] or "{}"))
        if not config.storage_state_path and row["storage_state_path"]:
            config.storage_state_path = row["storage_state_path"]
        result = await scrape(row["product_url"], config)

        if result.error:
            logger.error("Scrape error for ps_id=%d: %s", product_store_id, result.error)
            return {
                "status": "failed",
                "product_store_id": product_store_id,
                "error": result.error,
                "result": result,
            }

        local_code, local_symbol = await get_settings_currency(db)
        currency_code = infer_currency_code(
            result.raw_price,
            result.raw_discounted,
            result.raw_dealer,
            local_code=local_code,
            local_symbol=local_symbol,
        )

        if not _has_any_price(result):
            previous = await _latest_price_row(db, product_store_id)
            if previous is None:
                logger.warning(
                    "Scrape returned no price for ps_id=%d; keeping product unchanged",
                    product_store_id,
                )
                return {
                    "status": "failed",
                    "product_store_id": product_store_id,
                    "error": "Scrape did not find a price",
                    "result": result,
                }
            if result.stock_status == "unknown":
                logger.warning(
                    "Scrape returned no price or stock change for ps_id=%d; keeping latest price",
                    product_store_id,
                )
                return {
                    "status": "skipped",
                    "product_store_id": product_store_id,
                    "reason": "no_price",
                    "result": result,
                }
            result.price = previous["price"]
            result.discounted_price = previous["discounted_price"]
            result.dealer_price = previous["dealer_price"]
            result.raw_price = result.raw_price or previous["raw_price"]
            result.raw_discounted = result.raw_discounted or previous["raw_discounted"]
            result.raw_dealer = result.raw_dealer or previous["raw_dealer"]
            result.title = result.title or previous["title"]
            currency_code = previous["currency_code"] or currency_code

        change_type, price_delta, previous_price, previous_stock_status = (
            await _compute_change(db, product_store_id, result)
        )

        await db.execute(
            """INSERT INTO price_logs
               (product_store_id, title, price, discounted_price, dealer_price,
                stock_status, raw_price, raw_discounted, raw_dealer, currency_code,
                change_type, price_delta, previous_price, previous_stock_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                currency_code,
                change_type,
                price_delta,
                previous_price,
                previous_stock_status,
            ),
        )
        await db.commit()
        logger.info(
            "Scraped ps_id=%d -> regular=%s discounted=%s dealer=%s stock=%s change=%s delta=%s",
            product_store_id,
            result.price,
            result.discounted_price,
            result.dealer_price,
            result.stock_status,
            change_type,
            price_delta,
        )
        return {
            "status": "scraped",
            "product_store_id": product_store_id,
            "change_type": change_type,
            "price_delta": price_delta,
            "result": result,
        }
    finally:
        await db.close()


async def scrape_all_active() -> ScrapeRunSummary:
    """Called by the scheduler. Scrapes every active product_store."""
    woo_error = None
    api_error = None

    try:
        from api.import_routes import sync_all_enabled_woo_stores

        await sync_all_enabled_woo_stores()
    except Exception as exc:
        logger.error("Failed syncing Woo stores before scrape-all: %s", exc)
        woo_error = str(exc)

    try:
        from api.import_routes import sync_all_enabled_api_stores

        await sync_all_enabled_api_stores()
    except Exception as exc:
        logger.error("Failed syncing API stores before scrape-all: %s", exc)
        api_error = str(exc)

    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT ps.id
               FROM product_stores ps
               JOIN stores s ON s.id = ps.store_id
               WHERE ps.is_active = 1
                 AND NOT (s.api_enabled = 1 AND s.api_platform IS NOT NULL)"""
        )
        ids = [row["id"] for row in rows]
    finally:
        await db.close()

    scraped = 0
    skipped = 0
    failed = 0
    errors: list[dict[str, object]] = []

    for product_store_id in ids:
        try:
            summary = await _do_scrape(product_store_id)
        except Exception as exc:
            logger.error("Failed scraping ps_id=%d: %s", product_store_id, exc)
            failed += 1
            errors.append({"product_store_id": product_store_id, "error": str(exc)})
            continue

        status = summary.get("status")
        if status == "scraped":
            scraped += 1
        elif status == "failed":
            failed += 1
            errors.append(
                {
                    "product_store_id": product_store_id,
                    "error": summary.get("error") or "Scrape failed",
                }
            )
        else:
            skipped += 1

    if woo_error:
        failed += 1
        errors.append({"product_store_id": None, "error": f"Woo sync failed: {woo_error}"})
    if api_error:
        failed += 1
        errors.append({"product_store_id": None, "error": f"API sync failed: {api_error}"})

    return {
        "status": "complete" if failed == 0 else "partial_failure",
        "total": len(ids),
        "scraped": scraped,
        "skipped": skipped,
        "failed": failed,
        "errors": errors,
    }


@router.post("/scrape/{product_store_id}")
async def manual_scrape(product_store_id: int):
    """Trigger an immediate scrape for a single product_store and return the result."""
    summary = await _do_scrape(product_store_id)
    status = summary.get("status")
    if status == "not_found":
        raise HTTPException(status_code=404, detail=summary.get("error"))
    if status == "skipped":
        raise HTTPException(
            status_code=409,
            detail="This store link is manual-only and cannot be scraped.",
        )
    if status == "failed":
        raise HTTPException(
            status_code=502,
            detail=summary.get("error") or "Scrape failed",
        )
    return summary


@router.post("/scrape-all")
async def manual_scrape_all():
    """Trigger an immediate scrape for all active product_stores and return a summary."""
    return await scrape_all_active()


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
    return config, f"Using saved login session from {store_name}."


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


_BUY_AREA_TARGETS = {"price", "discounted_price", "dealer_price", "stock_status", "title"}


def _validate_buy_area_target(target: str) -> str:
    target = (target or "").strip()
    if target not in _BUY_AREA_TARGETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown target_field {target!r}; must be one of "
                f"{sorted(_BUY_AREA_TARGETS)}"
            ),
        )
    return target


async def _load_scrape_config(db, product_store_id: int) -> ScrapeConfig:
    rows = await db.execute_fetchall(
        "SELECT scrape_config FROM product_stores WHERE id=?",
        (product_store_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="product_store not found")
    return ScrapeConfig(**json.loads(rows[0]["scrape_config"] or "{}"))


async def _save_scrape_config(db, product_store_id: int, config: ScrapeConfig) -> None:
    await db.execute(
        "UPDATE product_stores SET scrape_config=? WHERE id=?",
        (config.model_dump_json(), product_store_id),
    )
    await db.commit()


@router.put("/selector-lab/buy-area-pick", response_model=BuyAreaPicksResponse)
async def selector_lab_buy_area_pick_upsert(
    body: BuyAreaPickRequest,
) -> BuyAreaPicksResponse:
    """Pin a buy-area item as the value to track for one schema field.

    The pick replaces any existing pick with the same ``target_field`` on
    the same product_store. The engine replays this on every subsequent
    scrape, scoring live buy-area items against the saved fingerprint.
    """
    target = _validate_buy_area_target(body.pick.target_field)
    db = await get_db()
    try:
        config = await _load_scrape_config(db, body.product_store_id)
        # Replace-or-append by target_field.
        kept = [p for p in config.buy_area_picks if p.target_field != target]
        new_pick = body.pick.model_copy(update={"target_field": target})
        config.buy_area_picks = kept + [new_pick]
        await _save_scrape_config(db, body.product_store_id, config)
        return BuyAreaPicksResponse(
            product_store_id=body.product_store_id,
            picks=list(config.buy_area_picks),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Buy-area pick upsert failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save buy-area pick: {exc}",
        )
    finally:
        await db.close()


@router.delete(
    "/selector-lab/buy-area-pick/{product_store_id}/{target_field}",
    response_model=BuyAreaPicksResponse,
)
async def selector_lab_buy_area_pick_delete(
    product_store_id: int,
    target_field: str,
) -> BuyAreaPicksResponse:
    """Remove the pinned pick for a single ``target_field``."""
    target = _validate_buy_area_target(target_field)
    db = await get_db()
    try:
        config = await _load_scrape_config(db, product_store_id)
        before = len(config.buy_area_picks)
        config.buy_area_picks = [
            p for p in config.buy_area_picks if p.target_field != target
        ]
        if len(config.buy_area_picks) != before:
            await _save_scrape_config(db, product_store_id, config)
        return BuyAreaPicksResponse(
            product_store_id=product_store_id,
            picks=list(config.buy_area_picks),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Buy-area pick delete failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clear buy-area pick: {exc}",
        )
    finally:
        await db.close()


@router.get(
    "/selector-lab/buy-area-picks/{product_store_id}",
    response_model=BuyAreaPicksResponse,
)
async def selector_lab_buy_area_picks_list(
    product_store_id: int,
) -> BuyAreaPicksResponse:
    """List the current buy-area picks pinned to a product_store."""
    db = await get_db()
    try:
        config = await _load_scrape_config(db, product_store_id)
        return BuyAreaPicksResponse(
            product_store_id=product_store_id,
            picks=list(config.buy_area_picks),
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

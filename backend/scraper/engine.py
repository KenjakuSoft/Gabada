"""
Playwright-based scraper engine.
One shared browser instance for the lifetime of the app.
Handles both static HTML and JS-heavy SPAs.
"""
import re
import asyncio
import logging
from typing import Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Playwright

from database.models import ScrapeConfig, ScrapeResult

logger = logging.getLogger(__name__)

_playwright: Optional[Playwright] = None
_browser: Optional[Browser] = None
_lock = asyncio.Lock()


async def start_browser():
    global _playwright, _browser
    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    )
    logger.info("Playwright browser started")


async def stop_browser():
    global _playwright, _browser
    if _browser:
        await _browser.close()
    if _playwright:
        await _playwright.stop()
    logger.info("Playwright browser stopped")


def _parse_price(raw: Optional[str]) -> Optional[float]:
    """Extract a float from a price string like '$1,299.99' or '1.299,99 €'."""
    if not raw:
        return None
    # Remove everything except digits, dots, commas
    cleaned = re.sub(r"[^\d.,]", "", raw.strip())
    if not cleaned:
        return None
    # European format: 1.299,99 → 1299.99
    if re.match(r"^\d{1,3}(\.\d{3})+(,\d+)?$", cleaned):
        cleaned = cleaned.replace(".", "").replace(",", ".")
    else:
        # Remove thousands separators (commas before 3 digits)
        cleaned = re.sub(r",(\d{3})", r"\1", cleaned)
        cleaned = cleaned.replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_stock(raw: Optional[str]) -> str:
    if not raw:
        return "unknown"
    text = raw.lower().strip()
    if any(w in text for w in ["out of stock", "unavailable", "sold out", "no stock", "not available"]):
        return "out_of_stock"
    if any(w in text for w in ["limited", "low stock", "only", "hurry", "few left"]):
        return "limited"
    if any(w in text for w in ["in stock", "available", "add to cart", "buy now", "in-stock"]):
        return "in_stock"
    return "unknown"


async def scrape(url: str, config: ScrapeConfig) -> ScrapeResult:
    """Scrape a single product URL using the provided config."""
    async with _lock:
        if not _browser:
            raise RuntimeError("Browser not started — call start_browser() first")

    context: BrowserContext = await _browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
    )
    page = await context.new_page()

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)

        if config.wait_for:
            try:
                await page.wait_for_selector(config.wait_for, timeout=config.wait_timeout)
            except Exception:
                logger.warning("wait_for selector '%s' timed out on %s", config.wait_for, url)

        sel = config.selectors

        async def extract(selector: Optional[str]) -> Optional[str]:
            if not selector:
                return None
            try:
                el = await page.query_selector(selector)
                return (await el.inner_text()).strip() if el else None
            except Exception:
                return None

        async def extract_attr(selector: Optional[str], attr: str) -> Optional[str]:
            if not selector:
                return None
            try:
                el = await page.query_selector(selector)
                return await el.get_attribute(attr) if el else None
            except Exception:
                return None

        title = await extract(sel.title)
        raw_price = await extract(sel.price)
        raw_discounted = await extract(sel.discounted_price)
        stock_raw = await extract(sel.stock_status)
        image = await extract_attr(sel.image, "src") if sel.image else None

        return ScrapeResult(
            title=title,
            price=_parse_price(raw_price),
            discounted_price=_parse_price(raw_discounted),
            stock_status=_parse_stock(stock_raw),
            raw_price=raw_price,
            raw_discounted=raw_discounted,
        )

    except Exception as e:
        logger.error("Scrape failed for %s: %s", url, e)
        return ScrapeResult(error=str(e))
    finally:
        await context.close()

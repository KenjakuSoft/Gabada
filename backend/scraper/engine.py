"""
Smart scraper engine — no CSS selector config required.
Extraction order: JSON-LD → Schema microdata → common patterns → custom selectors.
One shared Playwright browser for the app lifetime.

Price filtering:
- Installment / EMI / monthly-payment candidates are suppressed at both the
  JS smart-scan stage and in Python before any price is accepted.
- Dealer / wholesale prices are surfaced separately via dedicated selectors
  and stored in the dealer_price field.
"""
import json
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
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    )
    logger.info("Playwright browser started")


async def stop_browser():
    global _playwright, _browser
    if _browser:
        await _browser.close()
    if _playwright:
        await _playwright.stop()
    logger.info("Playwright browser stopped")


# ── Installment / payment-method filter ──────────────────────────────────────

_INSTALLMENT_RE = re.compile(
    r"\b(emi|easy[\s-]?pay|flexi[\s-]?pay|instalment|installment|"
    r"monthly|per[\s-]?month|per[\s-]?week|weekly|"
    r"interest[\s-]?free|payment[\s-]?plan|hire[\s-]?purchase|"
    r"credit[\s-]?card[\s-]?price|card[\s-]?price|"
    r"visa[\s-]?offer|master[\s-]?offer)\b"
    r"|[×x]\s*\d+\s*(?:month|week|year|mo\b)"  # e.g. ×12 months
    r"|/\s*(?:month|week|mo|yr)\b",             # e.g. /month
    re.IGNORECASE,
)

def _is_installment_price(raw: Optional[str]) -> bool:
    """Return True if this raw string looks like an installment / payment-method price."""
    return bool(raw and _INSTALLMENT_RE.search(raw))


# ── Price & stock parsers ─────────────────────────────────────────────────────

def _parse_price(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    if _is_installment_price(raw):
        return None
    cleaned = re.sub(r"[^\d.,]", "", raw.strip())
    if not cleaned:
        return None
    # European format: 1.299,99
    if re.match(r"^\d{1,3}(\.\d{3})+(,\d+)?$", cleaned):
        cleaned = cleaned.replace(".", "").replace(",", ".")
    else:
        cleaned = re.sub(r",(\d{3})", r"\1", cleaned)
        cleaned = cleaned.replace(",", ".")
    try:
        v = float(cleaned)
        return v if v > 0 else None
    except ValueError:
        return None


def _parse_stock(raw: Optional[str]) -> str:
    if not raw:
        return "unknown"
    t = raw.lower().strip()
    if any(w in t for w in ["out of stock", "unavailable", "sold out", "no stock", "not available", "outofstock"]):
        return "out_of_stock"
    if any(w in t for w in ["limited", "low stock", "only", "hurry", "few left", "limitedavailability"]):
        return "limited"
    if any(w in t for w in ["in stock", "available", "add to cart", "buy now", "instock"]):
        return "in_stock"
    return "unknown"


def _stock_from_schema_url(url: str) -> str:
    url = url.lower()
    if "instock" in url:
        return "in_stock"
    if "outofstock" in url:
        return "out_of_stock"
    if "limitedavailability" in url or "limited" in url:
        return "limited"
    return "unknown"


# ── Strategy 1: JSON-LD ───────────────────────────────────────────────────────

async def _try_json_ld(page) -> ScrapeResult:
    scripts = await page.query_selector_all('script[type="application/ld+json"]')
    for script in scripts:
        try:
            text = await script.inner_text()
            data = json.loads(text)
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                t = str(item.get("@type", ""))
                if "Product" not in t:
                    continue

                name = item.get("name")

                offers = item.get("offers", {})
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}

                raw_price = str(offers.get("price", "")) if offers else ""
                raw_low = str(offers.get("lowPrice", "")) if offers else ""
                price = _parse_price(raw_price) or _parse_price(raw_low)
                raw = raw_price or raw_low or None

                avail = offers.get("availability", "") if offers else ""
                stock = _stock_from_schema_url(avail) if avail else "unknown"

                if name or price:
                    logger.info("JSON-LD hit: name=%s price=%s", name, price)
                    return ScrapeResult(
                        title=name,
                        price=price,
                        stock_status=stock,
                        raw_price=raw,
                    )
        except Exception:
            continue
    return ScrapeResult()


# ── Strategy 2: Schema.org microdata ─────────────────────────────────────────

async def _try_microdata(page) -> ScrapeResult:
    result = ScrapeResult()
    try:
        el = await page.query_selector('[itemprop="name"]')
        if el:
            result.title = (await el.inner_text()).strip() or None

        for sel in ('[itemprop="price"]', '[itemprop="lowPrice"]'):
            el = await page.query_selector(sel)
            if el:
                raw = await el.get_attribute("content") or await el.inner_text()
                if _is_installment_price(raw):
                    continue
                p = _parse_price(raw)
                if p:
                    result.price = p
                    result.raw_price = raw
                    break

        el = await page.query_selector('[itemprop="availability"]')
        if el:
            avail = await el.get_attribute("content") or await el.inner_text()
            result.stock_status = _stock_from_schema_url(avail) or _parse_stock(avail)
    except Exception:
        pass

    if result.price:
        logger.info("Microdata hit: name=%s price=%s", result.title, result.price)
    return result


# ── Strategy 3: Common CSS patterns ──────────────────────────────────────────

_PRICE_SELECTORS = [
    # Amazon
    ".priceToPay .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    ".a-price .a-offscreen",
    # Shopify
    "[data-product-price]",
    ".product__price",
    # WooCommerce
    ".price ins .amount",
    ".price .amount",
    # CS-Cart (redacted-store and similar)
    ".ty-price-now",
    # Custom PHP / simple stores (redacted-store and similar)
    "h4.price span",
    "h4.price",
    # Generic
    "[data-price]",
    ".price--main",
    ".product-price",
    ".regular-price",
    "[class*='ProductPrice']",
    "[class*='product-price']",
    "[class*='Price--']",
    ".js-price",
]

_ORIG_PRICE_SELECTORS = [
    # CS-Cart retail/original price
    ".ty-price-retail-price",
    # WooCommerce / generic
    ".price del .amount",
    ".price s .amount",
    "[data-compare-price]",
    ".product__price--compare",
    ".a-price.a-text-price .a-offscreen",
]

_DEALER_PRICE_SELECTORS = [
    ".ty-price-dealer",
    "[class*='dealer-price']",
    "[class*='wholesale-price']",
    "[class*='trade-price']",
    "[data-dealer-price]",
    ".dealer-price",
    ".trade-price",
    ".wholesale-price",
    ".your-price",        # some B2B stores label it "Your Price"
]

_STOCK_SELECTORS = [
    # CS-Cart (redacted-store)
    ".ty-special-msg",
    # Custom PHP (redacted-store)
    ".ProInfo dd",
    # Amazon / generic
    "#availability span",
    ".availability",
    "[class*='stock']",
    "[class*='availability']",
    "[class*='in-stock']",
    "[class*='out-of-stock']",
    ".add-to-cart-button",
]

_TITLE_SELECTORS = [
    "h1[class*='product']",
    "h1[class*='title']",
    "h1[itemprop='name']",
    ".product-title h1",
    ".product__title",
    "#productTitle",  # Amazon
    "h1",
]


async def _try_common(page) -> ScrapeResult:
    result = ScrapeResult()
    try:
        for sel in _PRICE_SELECTORS:
            el = await page.query_selector(sel)
            if el:
                raw = await el.get_attribute("content") or await el.inner_text()
                if _is_installment_price(raw):
                    continue
                p = _parse_price(raw)
                if p:
                    result.price = p
                    result.raw_price = raw.strip()
                    break

        for sel in _ORIG_PRICE_SELECTORS:
            el = await page.query_selector(sel)
            if el:
                raw = await el.get_attribute("content") or await el.inner_text()
                if _is_installment_price(raw):
                    continue
                p = _parse_price(raw)
                if p and (result.price is None or p > result.price):
                    result.discounted_price = result.price
                    result.price = p
                    result.raw_discounted = result.raw_price
                    result.raw_price = raw.strip()
                    break

        for sel in _DEALER_PRICE_SELECTORS:
            el = await page.query_selector(sel)
            if el:
                raw = await el.get_attribute("content") or await el.inner_text()
                if not _is_installment_price(raw):
                    d = _parse_price(raw)
                    if d:
                        result.dealer_price = d
                        result.raw_dealer = raw.strip()
                        break

        for sel in _TITLE_SELECTORS:
            el = await page.query_selector(sel)
            if el:
                t = (await el.inner_text()).strip()
                if t:
                    result.title = t
                    break

        for sel in _STOCK_SELECTORS:
            els = await page.query_selector_all(sel)
            for el in els:
                t = await el.inner_text()
                s = _parse_stock(t)
                if s != "unknown":
                    result.stock_status = s
                    break
            if result.stock_status != "unknown":
                break

    except Exception as e:
        logger.debug("Common pattern extraction error: %s", e)

    if result.price:
        logger.info("Common pattern hit: name=%s price=%s dealer=%s", result.title, result.price, result.dealer_price)
    return result


# ── Strategy 3b: Universal JS smart scan ─────────────────────────────────────

_SMART_SCAN_JS = r"""() => {
    function visible(el) {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden'
            && parseFloat(s.opacity || '1') > 0;
    }

    function contextScore(el) {
        let score = 0, cur = el;
        for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            const info = ((cur.className || '') + ' ' + (cur.id || '')).toLowerCase();
            if (/\bprice\b/.test(info))               score += 15;
            if (/\bcost\b|\bamount\b/.test(info))     score += 8;
            if (/sale|offer|deal|now|current/.test(info)) score += 5;
            if (/product|summary|detail|info/.test(info)) score += 3;
            if (/cart|basket|total|order|ship/.test(info)) score -= 12;
            if (/retail|was|compare|original|old/.test(info)) score -= 8;
            if (/related|similar|recommend|cross/.test(info)) score -= 20;
            if (/nav|menu|header|footer/.test(info))  score -= 15;
            // Installment / payment-method penalty
            if (/emi|monthly|instalment|installment|per.?month|easy.?pay|flexi|interest.?free|per.?week|weekly|payment.?plan/.test(info)) score -= 30;
            if (/visa|mastercard|credit.?card|debit.?card|payment.?method|card.?offer/.test(info)) score -= 20;
        }
        return score;
    }

    // Match text nodes that are ONLY a price value (with optional currency symbol)
    const priceRe = /^(?:(?:Rs\.?|LKR|USD|AED|SGD|MYR|INR|PHP|BDT|\$|€|£|¥|฿)\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/=|Rs\.?|LKR)?$/i;

    const candidates = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        const m = text.match(priceRe);
        if (!m) continue;
        const el = node.parentElement;
        if (!el || !visible(el)) continue;
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (num <= 0 || num > 50000000) continue;

        // Reject if ancestor text hints at installment context
        let ancestorText = '';
        let cur = el;
        for (let i = 0; i < 3 && cur; i++, cur = cur.parentElement) {
            ancestorText += ' ' + (cur.textContent || '');
        }
        if (/\bemi\b|per\s+month|\/month|monthly\s+pay|easy\s+pay|instalment|installment|\d\s*[x×]\s*\d+\s*(?:month|mo\b)/i.test(ancestorText.slice(0, 200))) continue;

        candidates.push({ text, num, score: contextScore(el) });
    }
    candidates.sort((a, b) => b.score - a.score || a.num - b.num);

    // Stock: inspect add-to-cart / buy button state
    let stock = 'unknown';
    const btnSelectors = [
        'button[name*="cart"]', 'button[class*="cart"]', 'button[id*="cart"]',
        'button[class*="buy"]', 'button[id*="buy"]',
        'input[type="submit"]', '.add-to-cart', '.buy-now',
        '#add-to-cart-button', '[data-action="add-to-cart"]',
        'button[class*="add"]', 'a[class*="add-to-cart"]',
    ];
    outer: for (const sel of btnSelectors) {
        for (const btn of document.querySelectorAll(sel)) {
            if (!visible(btn)) continue;
            const t = (btn.textContent || btn.value || '').toLowerCase();
            if (/out.?of.?stock|sold.?out|unavailable|notify.?me/.test(t)) {
                stock = 'out_of_stock'; break outer;
            }
            if (btn.disabled || btn.getAttribute('disabled') !== null) {
                stock = 'out_of_stock'; break outer;
            }
            if (/add|buy|cart|order|purchase|checkout|shop.?now/.test(t)) {
                stock = 'in_stock'; break outer;
            }
        }
    }

    // Fallback: scan visible page text for stock keywords
    if (stock === 'unknown') {
        const text = (document.body.innerText || '').toLowerCase();
        if (/\bout[\s-]of[\s-]stock\b|\bsold[\s-]out\b|\bnot available\b/.test(text))
            stock = 'out_of_stock';
        else if (/\bin[\s-]stock\b/.test(text))
            stock = 'in_stock';
        else if (/\blimited[\s-]stock\b|\blow[\s-]stock\b/.test(text))
            stock = 'limited';
    }

    return { candidates: candidates.slice(0, 10), stock };
}"""


async def _try_smart_scan(page) -> ScrapeResult:
    result = ScrapeResult()
    try:
        data = await page.evaluate(_SMART_SCAN_JS)
        candidates = data.get('candidates', [])

        # Drop any remaining installment-like candidates on the Python side
        candidates = [c for c in candidates if not _is_installment_price(c.get('text', ''))]

        if candidates:
            best = candidates[0]
            result.price = _parse_price(best['text']) or (best['num'] if best['num'] > 0 else None)
            result.raw_price = best['text']

            if result.price:
                original = None
                seen_nums = {best['num']}
                for cand in candidates[1:]:
                    if cand['num'] in seen_nums:
                        continue
                    seen_nums.add(cand['num'])
                    if (cand['num'] > best['num']
                            and cand['score'] >= 0
                            and cand['num'] < best['num'] * 2.5):
                        if original is None or cand['num'] > original['num']:
                            original = cand
                if original:
                    result.discounted_price = result.price
                    result.raw_discounted = result.raw_price
                    result.price = _parse_price(original['text']) or original['num']
                    result.raw_price = original['text']

            logger.info("Smart scan hit: price=%s disc=%s", result.price, result.discounted_price)

        result.stock_status = data.get('stock', 'unknown')

    except Exception as e:
        logger.debug("Smart scan error: %s", e)

    return result


# ── Strategy 4: Custom selectors (user-configured override) ──────────────────

async def _apply_custom(page, config: ScrapeConfig, base: ScrapeResult) -> ScrapeResult:
    sel = config.selectors

    async def get_text(selector: Optional[str]) -> Optional[str]:
        if not selector:
            return None
        try:
            el = await page.query_selector(selector)
            return (await el.inner_text()).strip() if el else None
        except Exception:
            return None

    title = await get_text(sel.title)
    raw_price = await get_text(sel.price)
    raw_disc = await get_text(sel.discounted_price)
    raw_dealer = await get_text(sel.dealer_price)
    stock_raw = await get_text(sel.stock_status)

    # Guard custom selectors against installment prices too
    if _is_installment_price(raw_price):
        raw_price = None
    if _is_installment_price(raw_disc):
        raw_disc = None
    if _is_installment_price(raw_dealer):
        raw_dealer = None

    return ScrapeResult(
        title=title or base.title,
        price=_parse_price(raw_price) or base.price,
        discounted_price=_parse_price(raw_disc) or base.discounted_price,
        dealer_price=_parse_price(raw_dealer) or base.dealer_price,
        stock_status=(_parse_stock(stock_raw) if stock_raw else None) or base.stock_status,
        raw_price=raw_price or base.raw_price,
        raw_discounted=raw_disc or base.raw_discounted,
        raw_dealer=raw_dealer or base.raw_dealer,
    )


# ── Main scrape function ──────────────────────────────────────────────────────

async def scrape(url: str, config: ScrapeConfig) -> ScrapeResult:
    async with _lock:
        if not _browser:
            raise RuntimeError("Browser not started")

    context: BrowserContext = await _browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        locale="en-US",
    )
    page = await context.new_page()

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)

        if config.wait_for:
            try:
                await page.wait_for_selector(config.wait_for, timeout=config.wait_timeout)
            except Exception:
                logger.warning("wait_for '%s' timed out on %s", config.wait_for, url)
        else:
            try:
                await page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass

        result = await _try_json_ld(page)
        if not result.price:
            result = await _try_microdata(page)

        if not result.price or result.stock_status == "unknown":
            smart = await _try_smart_scan(page)
            if not result.price and smart.price:
                result = smart
            elif result.stock_status == "unknown" and smart.stock_status != "unknown":
                result.stock_status = smart.stock_status

        if not result.price:
            result = await _try_common(page)

        sel = config.selectors
        has_custom = any([sel.title, sel.price, sel.discounted_price, sel.dealer_price, sel.stock_status])
        if has_custom:
            result = await _apply_custom(page, config, result)

        if not result.stock_status:
            result.stock_status = "unknown"

        logger.info("Scrape done: %s → price=%s dealer=%s stock=%s",
                    url, result.price, result.dealer_price, result.stock_status)
        return result

    except Exception as e:
        logger.error("Scrape failed for %s: %s", url, e)
        return ScrapeResult(error=str(e))
    finally:
        await context.close()

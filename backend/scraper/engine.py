"""
Smart scraper engine — no CSS selector config required.

Extraction order:
    JSON-LD → Schema microdata → deterministic smart scan → common CSS patterns
    → user custom selectors (last).

Design goals:
    - Stable price selection across repeated scrapes of the same DOM.
    - Never let the smart scan overwrite a structured-data hit.
    - Surface dealer / wholesale / trade prices separately.
    - Support cookies / storage_state so logged-in dealer prices can be read.
    - Support a probe() mode that returns every candidate for diagnostics.

One shared Playwright browser for the app lifetime.
"""
import json
import os
import re
import asyncio
import logging
from typing import Optional

from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Playwright,
    Page,
)

from database.models import (
    ProbeCandidate,
    ProbeResponse,
    ScrapeConfig,
    ScrapeResult,
)

logger = logging.getLogger(__name__)

_playwright: Optional[Playwright] = None
_browser: Optional[Browser] = None
_lock = asyncio.Lock()


async def start_browser() -> None:
    global _playwright, _browser
    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    )
    logger.info("Playwright browser started")


async def stop_browser() -> None:
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
    r"|[×x]\s*\d+\s*(?:month|week|year|mo\b)"
    r"|/\s*(?:month|week|mo|yr)\b",
    re.IGNORECASE,
)


def _is_installment_price(raw: Optional[str]) -> bool:
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
    # Pre-order / back-order checked FIRST — these often co-occur with
    # "available" / "add to cart" phrasing that would otherwise mask them.
    if any(w in t for w in [
        "pre-order", "pre order", "preorder", "pre-sale", "presale",
        "coming soon", "notify me", "notify when available",
        "expected", "eta", "ships on", "ships in",
    ]):
        return "preorder"
    if any(w in t for w in [
        "back-order", "back order", "backorder", "on backorder",
        "onbackorder",
    ]):
        return "backorder"
    if any(w in t for w in [
        "out of stock", "unavailable", "sold out", "no stock",
        "not available", "outofstock", "discontinued",
    ]):
        return "out_of_stock"
    if any(w in t for w in [
        "limited", "low stock", "only", "hurry", "few left",
        "limitedavailability",
    ]):
        return "limited"
    if any(w in t for w in [
        "in stock", "available", "add to cart", "buy now", "instock",
    ]):
        return "in_stock"
    return "unknown"


def _stock_from_schema_url(url: str) -> str:
    url = url.lower()
    if "preorder" in url or "presale" in url:
        return "preorder"
    if "backorder" in url:
        return "backorder"
    if "instock" in url:
        return "in_stock"
    if "outofstock" in url:
        return "out_of_stock"
    if "limitedavailability" in url or "limited" in url:
        return "limited"
    return "unknown"


# ── Strategy 1: JSON-LD ───────────────────────────────────────────────────────

async def _try_json_ld(page: Page) -> ScrapeResult:
    scripts = await page.query_selector_all('script[type="application/ld+json"]')
    for script in scripts:
        try:
            text = await script.inner_text()
            data = json.loads(text)
            items = data if isinstance(data, list) else [data]
            # Handle @graph wrapper
            expanded = []
            for item in items:
                if isinstance(item, dict) and isinstance(item.get("@graph"), list):
                    expanded.extend(item["@graph"])
                else:
                    expanded.append(item)

            for item in expanded:
                if not isinstance(item, dict):
                    continue
                t = item.get("@type", "")
                t_str = " ".join(t) if isinstance(t, list) else str(t)
                if "Product" not in t_str:
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

async def _try_microdata(page: Page) -> ScrapeResult:
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
            result.stock_status = (
                _stock_from_schema_url(avail) or _parse_stock(avail)
            )
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
    ".price-item--sale",
    # WooCommerce
    ".price ins .amount",
    ".price .amount",
    # CS-Cart (nanotek.lk, barclayscomputers.lk, and similar B2B-enabled stores)
    ".ty-price-now .ty-price-num",
    ".ty-price-now",
    ".ty-price .ty-price-num",
    # Magento
    "[data-price-type='finalPrice'] .price",
    ".price-box .price",
    # PrestaShop
    "#our_price_display",
    ".current-price",
    # Custom PHP / simple stores
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
    ".ty-list-price",
    # WooCommerce / generic
    ".price del .amount",
    ".price s .amount",
    "[data-compare-price]",
    ".product__price--compare",
    ".price__compare",
    ".a-price.a-text-price .a-offscreen",
    # Magento
    "[data-price-type='oldPrice'] .price",
]

_DEALER_PRICE_SELECTORS = [
    ".ty-price-dealer",
    "[class*='dealer-price']",
    "[class*='wholesale-price']",
    "[class*='trade-price']",
    "[data-dealer-price]",
    "[data-price-type='dealer']",
    ".dealer-price",
    ".trade-price",
    ".wholesale-price",
    ".your-price",
    ".b2b-price",
]

_STOCK_SELECTORS = [
    # CS-Cart (nanotek.lk, barclayscomputers.lk)
    ".ty-special-msg",
    ".ty-qty-in-stock",
    ".ty-qty-out-of-stock",
    # Custom PHP (gamestreet.lk)
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
    ".ty-product-block-title",
    "#productTitle",  # Amazon
    "h1",
]


async def _try_common(page: Page) -> ScrapeResult:
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
                if p and result.price is not None and p > result.price:
                    # Current sale price stays in .price; original moves to .discounted_price swap.
                    # Convention here: price = original/retail, discounted_price = sale/current.
                    result.discounted_price = result.price
                    result.raw_discounted = result.raw_price
                    result.price = p
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
            found = False
            for el in els:
                t = await el.inner_text()
                s = _parse_stock(t)
                if s != "unknown":
                    result.stock_status = s
                    found = True
                    break
            if found:
                break

    except Exception as e:
        logger.debug("Common pattern extraction error: %s", e)

    if result.price:
        logger.info(
            "Common pattern hit: name=%s price=%s dealer=%s",
            result.title, result.price, result.dealer_price,
        )
    return result


# ── Strategy 3b: Deterministic smart scan ────────────────────────────────────
#
# Rather than pick the top-scored text node (unstable when multiple candidates
# tie), this implementation:
#   1. Collects every visible price-looking text node.
#   2. Marks each as struck-through / dealer-scoped via ancestor inspection.
#   3. Picks the main price deterministically: not struck, not dealer,
#      highest context score, largest font-size, smallest value (to prefer
#      the sale price when a layout shows two identical mains).
#   4. Picks the "original/was" price as the struck-through candidate whose
#      value is strictly greater than the main price.
#   5. Picks the dealer price as the dealer-scoped candidate with highest score.
#
# Ordering is stable because sort keys are pure functions of the DOM.
# Installment / EMI contexts are filtered before candidates are collected.

_SMART_SCAN_JS = r"""() => {
    function visible(el) {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden'
            && parseFloat(s.opacity || '1') > 0;
    }

    const BAD = /cart|basket|total|order|ship|emi|monthly|instalment|installment|per[\s-]?month|easy[\s-]?pay|flexi|interest[\s-]?free|per[\s-]?week|payment[\s-]?plan|visa|mastercard|credit[\s-]?card|debit[\s-]?card|card[\s-]?offer|related|similar|recommend|cross[\s-]?sell|upsell|nav|menu|header|footer/i;
    const STRIKE = /\b(retail|was|compare|original|old|regular|strike|crossed|del-price|list-price|ty-list-price|ty-price-retail|mrp|rrp|old-price|price-old|was-price|price-was|sale-was|line-through|strikethrough|previous-price|msrp|rrp-price|price-old-amount)\b/i;
    const DEALER = /dealer|wholesale|trade|b2b|your[\s-]?price|distributor|reseller/i;
    const PRICE_CONTEXT = /\bprice\b|\bcost\b|\bamount\b/i;
    const PROD_CONTEXT = /product|summary|detail|info|offer|sale|now|current|item-main|ty-product-block|prod-main/i;
    const SALE_SIGNAL = /\b(save|was|regular|originally|compare|rrp|mrp|msrp|list[\s-]?price|retail[\s-]?price|you[\s-]?save|off)\b|\d+\s*%\s*off|−\s*\d|-\s*\d+\s*%/i;

    function isStruck(el) {
        let cur = el;
        for (let i = 0; i < 5 && cur; i++, cur = cur.parentElement) {
            const tag = cur.tagName;
            if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return true;
            try {
                const style = window.getComputedStyle(cur);
                const td = style.textDecorationLine || style.textDecoration || '';
                if (td.includes('line-through')) return true;
            } catch (_) {}
            const info = ((cur.className || '') + ' ' + (cur.id || '')).toString();
            if (STRIKE.test(info)) return true;
        }
        return false;
    }

    function isDealer(el) {
        let cur = el;
        for (let i = 0; i < 5 && cur; i++, cur = cur.parentElement) {
            const info = ((cur.className || '') + ' ' + (cur.id || '') +
                          ' ' + (cur.getAttribute && cur.getAttribute('data-price-type') || '')
                         ).toString();
            if (DEALER.test(info)) return true;
        }
        return false;
    }

    function inBadContext(el) {
        let cur = el;
        for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            const info = ((cur.className || '') + ' ' + (cur.id || '')).toString();
            if (BAD.test(info)) return true;
        }
        return false;
    }

    function contextScore(el) {
        let score = 0;
        let cur = el;
        for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            const info = ((cur.className || '') + ' ' + (cur.id || '')).toString();
            if (PRICE_CONTEXT.test(info)) score += 20;
            if (PROD_CONTEXT.test(info))  score += 6;
        }
        return score;
    }

    function domPath(el) {
        const parts = [];
        let p = el;
        for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
            const cls = (p.className && typeof p.className === 'string')
                ? p.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
                : '';
            parts.push(p.tagName.toLowerCase() + (cls ? '.' + cls : ''));
        }
        return parts.reverse().join(' > ');
    }

    const priceRe = /^(?:(?:Rs\.?|LKR|USD|AED|SGD|MYR|INR|PHP|BDT|\$|€|£|¥|฿|₹|₽)\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/=|Rs\.?|LKR|USD)?$/i;

    const candidates = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        const text = (node.textContent || '').trim();
        if (!text) continue;
        const m = text.match(priceRe);
        if (!m) continue;
        const el = node.parentElement;
        if (!el || !visible(el)) continue;
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (!(num > 0) || num > 50000000) continue;
        if (inBadContext(el)) continue;

        let fontSize = 14, fontWeight = 400;
        try {
            const style = window.getComputedStyle(el);
            fontSize = parseFloat(style.fontSize) || 14;
            fontWeight = parseInt(style.fontWeight, 10) || 400;
        } catch (_) {}

        // Scan up to 4 ancestors for any sale-signal text ("was", "save",
        // "%", "rrp", "mrp", etc.). This lets us recognize original prices
        // that aren't visually struck but sit near a discount hint.
        let nearSaleSignal = false;
        let ancestor = el;
        for (let i = 0; i < 4 && ancestor; i++, ancestor = ancestor.parentElement) {
            const txt = (ancestor.textContent || '').slice(0, 400);
            if (SALE_SIGNAL.test(txt)) { nearSaleSignal = true; break; }
        }

        candidates.push({
            text,
            value: num,
            score: contextScore(el),
            font_size: fontSize,
            font_weight: fontWeight,
            struck: isStruck(el),
            dealer: isDealer(el),
            near_sale_signal: nearSaleSignal,
            dom_path: domPath(el),
        });
    }

    // Deterministic main-price selection.
    // Prefer: not struck, not dealer, highest score, largest font,
    //         then heaviest weight, then smallest value, then earliest DOM order.
    const mains = candidates
        .map((c, i) => ({ ...c, _i: i }))
        .filter(c => !c.struck && !c.dealer)
        .sort((a, b) =>
              b.score - a.score
           || b.font_size - a.font_size
           || b.font_weight - a.font_weight
           || a.value - b.value
           || a._i - b._i);

    const main = mains[0] || null;

    let original = null;
    if (main) {
        // Preferred: an explicitly struck candidate greater than main.
        original = candidates
            .filter(c => c.struck && !c.dealer && c.value > main.value)
            .sort((a, b) => b.value - a.value)[0] || null;
        // Fallback: when no strike was detected (sites that style "was" price
        // via color/size instead of line-through — e.g. MD store), pick the
        // largest non-dealer candidate that sits near a sale signal AND is
        // meaningfully greater than the main price (≥5% higher).
        if (!original) {
            original = candidates
                .filter(c =>
                    !c.dealer
                    && c.near_sale_signal
                    && c.value > main.value * 1.05
                    && c.value <= main.value * 10)
                .sort((a, b) => b.value - a.value)[0] || null;
        }
    }

    const dealer = candidates
        .filter(c => c.dealer)
        .sort((a, b) => b.score - a.score || b.font_size - a.font_size)[0] || null;

    // Stock detection (order matters: pre-order/back-order before in-stock,
    // because preorder buttons often also say "Order now").
    let stock = 'unknown';
    const btnSelectors = [
        'button[name*="cart"]', 'button[class*="cart"]', 'button[id*="cart"]',
        'button[class*="buy"]', 'button[id*="buy"]',
        'button[class*="preorder"]', 'button[class*="pre-order"]',
        'input[type="submit"][value*="cart" i]',
        'input[type="submit"][value*="buy" i]',
        'input[type="submit"][value*="pre-order" i]',
        '.add-to-cart', '.buy-now', '#add-to-cart-button',
        '[data-action="add-to-cart"]', 'button[class*="add"]',
        'a[class*="add-to-cart"]',
        '.preorder-button', '.pre-order-button', '.notify-me',
    ];
    outer: for (const sel of btnSelectors) {
        for (const btn of document.querySelectorAll(sel)) {
            if (!visible(btn)) continue;
            const t = ((btn.textContent || btn.value || '') + '').toLowerCase();
            if (/pre[\s-]?order|pre[\s-]?sale|coming[\s-]?soon|notify[\s-]?me|notify[\s-]?when/.test(t)) {
                stock = 'preorder'; break outer;
            }
            if (/back[\s-]?order|on[\s-]?backorder/.test(t)) {
                stock = 'backorder'; break outer;
            }
            if (/out.?of.?stock|sold.?out|unavailable/.test(t)) {
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
    if (stock === 'unknown') {
        const text = (document.body.innerText || '').toLowerCase();
        if (/\bpre[\s-]?order\b|\bpre[\s-]?sale\b|\bcoming[\s-]soon\b|\bnotify[\s-]when[\s-]available\b/.test(text))
            stock = 'preorder';
        else if (/\bback[\s-]?order\b|\bon[\s-]?backorder\b/.test(text))
            stock = 'backorder';
        else if (/\bout[\s-]of[\s-]stock\b|\bsold[\s-]out\b|\bnot available\b/.test(text))
            stock = 'out_of_stock';
        else if (/\bin[\s-]stock\b/.test(text))
            stock = 'in_stock';
        else if (/\blimited[\s-]stock\b|\blow[\s-]stock\b/.test(text))
            stock = 'limited';
    }

    // Platform fingerprint
    let platform = 'generic';
    try {
        if (document.querySelector('.ty-price, .ty-price-num, [class*="ty-product-block"]')) {
            platform = 'cs-cart';
        } else if (document.querySelector('.woocommerce, body[class*="woocommerce"]')) {
            platform = 'woocommerce';
        } else if (document.querySelector('[data-shopify], body[class*="template-product"], #shopify-section-product')) {
            platform = 'shopify';
        } else if (document.querySelector('.catalog-product-view, #product-info-main, body[class*="catalog-product"]')) {
            platform = 'magento';
        } else if (document.querySelector('#product_page_product_name, body[id="product"], body.product-page')) {
            platform = 'prestashop';
        }
    } catch (_) {}

    return {
        main, original, dealer,
        candidates: candidates.slice(0, 30),
        stock,
        platform,
    };
}"""


async def _run_smart_scan(page: Page) -> dict:
    try:
        return await page.evaluate(_SMART_SCAN_JS)
    except Exception as e:
        logger.debug("Smart scan error: %s", e)
        return {
            "main": None, "original": None, "dealer": None,
            "candidates": [], "stock": "unknown", "platform": "generic",
        }


async def _try_smart_scan(page: Page) -> ScrapeResult:
    result = ScrapeResult()
    data = await _run_smart_scan(page)
    main = data.get("main")
    original = data.get("original")
    dealer = data.get("dealer")

    if main and not _is_installment_price(main.get("text")):
        result.price = _parse_price(main["text"]) or main.get("value")
        result.raw_price = main.get("text")

    if original and not _is_installment_price(original.get("text")):
        # Convention: price = retail/original, discounted_price = sale/current
        if result.price is not None:
            result.discounted_price = result.price
            result.raw_discounted = result.raw_price
            result.price = _parse_price(original["text"]) or original.get("value")
            result.raw_price = original.get("text")

    if dealer and not _is_installment_price(dealer.get("text")):
        result.dealer_price = _parse_price(dealer["text"]) or dealer.get("value")
        result.raw_dealer = dealer.get("text")

    result.stock_status = data.get("stock", "unknown") or "unknown"

    if result.price:
        logger.info(
            "Smart scan hit: price=%s disc=%s dealer=%s",
            result.price, result.discounted_price, result.dealer_price,
        )
    return result


# ── Strategy 4: Custom selectors (user-configured override) ──────────────────

async def _apply_custom(
    page: Page, config: ScrapeConfig, base: ScrapeResult
) -> ScrapeResult:
    sel = config.selectors

    async def get_text(selector: Optional[str]) -> Optional[str]:
        if not selector:
            return None
        try:
            el = await page.query_selector(selector)
            if not el:
                return None
            return (await el.inner_text()).strip() or None
        except Exception:
            return None

    title = await get_text(sel.title)
    raw_price = await get_text(sel.price)
    raw_disc = await get_text(sel.discounted_price)
    raw_dealer = await get_text(sel.dealer_price)
    stock_raw = await get_text(sel.stock_status)

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
        stock_status=(
            _parse_stock(stock_raw) if stock_raw else None
        ) or base.stock_status,
        raw_price=raw_price or base.raw_price,
        raw_discounted=raw_disc or base.raw_discounted,
        raw_dealer=raw_dealer or base.raw_dealer,
    )


# ── Context factory (shared by scrape() and probe()) ─────────────────────────

# Stealth init script: mask the most obvious headless-Chromium fingerprints
# before any site script runs. Needed to get past Cloudflare, DataDome,
# PerimeterX, and similar bot walls that gate products behind a challenge page.
_STEALTH_INIT_JS = r"""
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ],
});
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
try {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
} catch (_) {}
window.chrome = window.chrome || {
    app: { isInstalled: false, InstallState: {}, RunningState: {} },
    runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
    csi: function () {},
    loadTimes: function () {},
};
try {
    const _origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (_origQuery) {
        window.navigator.permissions.query = (parameters) =>
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : _origQuery(parameters);
    }
} catch (_) {}
try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.apply(this, [parameter]);
    };
} catch (_) {}
"""


async def _open_context(config: ScrapeConfig) -> BrowserContext:
    """
    Create a new Playwright context pre-configured with cookies, headers,
    and an optional saved storage_state (for logged-in scraping). Installs
    stealth init scripts so bot walls (Cloudflare, DataDome) are less likely
    to challenge the request.
    """
    if not _browser:
        raise RuntimeError("Browser not started")

    options: dict = dict(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        locale="en-US",
        timezone_id="Asia/Colombo",
        extra_http_headers={
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,image/apng,*/*;q=0.8,"
                "application/signed-exchange;v=b3;q=0.7"
            ),
            "sec-ch-ua": '"Chromium";v="124", "Not-A.Brand";v="99", "Google Chrome";v="124"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Upgrade-Insecure-Requests": "1",
        },
    )

    if config.storage_state_path and os.path.exists(config.storage_state_path):
        options["storage_state"] = config.storage_state_path
        logger.info("Using storage_state from %s", config.storage_state_path)

    context = await _browser.new_context(**options)
    try:
        await context.add_init_script(_STEALTH_INIT_JS)
    except Exception as e:
        logger.debug("Could not attach stealth init script: %s", e)

    if config.cookies:
        try:
            await context.add_cookies(config.cookies)
        except Exception as e:
            logger.warning("Failed to add cookies: %s", e)

    if config.headers:
        try:
            await context.set_extra_http_headers(config.headers)
        except Exception as e:
            logger.warning("Failed to set headers: %s", e)

    return context


_CLOUDFLARE_HINTS = (
    "just a moment",
    "checking your browser",
    "verify you are human",
    "verifying you are human",
    "needs to review the security of your connection",
    "enable javascript and cookies to continue",
    "please wait while we check your browser",
    "ddos protection by",
)


async def _detected_challenge(page: Page) -> bool:
    try:
        for sel in (
            "#challenge-running",
            "#challenge-form",
            "#cf-challenge-running",
            'iframe[src*="challenges.cloudflare.com"]',
            'div[class*="cf-browser-verification"]',
            'div[id*="px-captcha"]',
        ):
            el = await page.query_selector(sel)
            if el:
                return True
        title = (await page.title()) or ""
        if title.strip().lower() in {"just a moment...", "just a moment…"}:
            return True
        # Only read a slice of innerText to keep this cheap.
        text = await page.evaluate(
            "() => (document.body && document.body.innerText || '').slice(0, 600).toLowerCase()"
        )
        return any(h in text for h in _CLOUDFLARE_HINTS)
    except Exception:
        return False


async def _wait_for_challenge_clear(page: Page, timeout_ms: int = 25000) -> bool:
    """
    If Cloudflare / similar is running, wait up to timeout_ms for it to clear.
    Returns True when the page no longer looks like a challenge.
    """
    import time as _time

    deadline = _time.monotonic() + (timeout_ms / 1000.0)
    while _time.monotonic() < deadline:
        if not await _detected_challenge(page):
            return True
        try:
            # Let the challenge script run and optionally auto-navigate.
            await page.wait_for_load_state("networkidle", timeout=3000)
        except Exception:
            await asyncio.sleep(0.8)
    return not await _detected_challenge(page)


async def _navigate(page: Page, url: str, config: ScrapeConfig) -> None:
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)

    # Bot-wall handling: if the landing page is a challenge, give it a
    # chance to auto-resolve before we look for product selectors.
    if await _detected_challenge(page):
        logger.info("Bot-check challenge detected on %s — waiting for clear", url)
        cleared = await _wait_for_challenge_clear(page)
        if not cleared:
            logger.warning("Bot-check challenge did not clear on %s", url)

    if config.wait_for:
        try:
            await page.wait_for_selector(
                config.wait_for, timeout=config.wait_timeout
            )
        except Exception:
            logger.warning("wait_for '%s' timed out on %s", config.wait_for, url)
    else:
        try:
            await page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass


# ── Main scrape function ──────────────────────────────────────────────────────

async def scrape(url: str, config: ScrapeConfig) -> ScrapeResult:
    async with _lock:
        if not _browser:
            raise RuntimeError("Browser not started")

    context = await _open_context(config)
    page = await context.new_page()

    try:
        await _navigate(page, url, config)

        # Strategy waterfall. Structured data always wins.
        result = await _try_json_ld(page)
        if not result.price:
            result = await _try_microdata(page)

        # Smart scan fills gaps. Never overwrites a JSON-LD / microdata price.
        if not result.price or result.stock_status in (None, "unknown"):
            smart = await _try_smart_scan(page)
            if not result.price and smart.price:
                # Preserve title from earlier strategies if they found one
                preserved_title = result.title
                result = smart
                result.title = preserved_title or smart.title
            if result.stock_status in (None, "unknown") and smart.stock_status not in (None, "unknown"):
                result.stock_status = smart.stock_status
            # Opportunistic dealer / discounted fill-in
            if smart.dealer_price and not result.dealer_price:
                result.dealer_price = smart.dealer_price
                result.raw_dealer = smart.raw_dealer
            if smart.discounted_price and not result.discounted_price:
                result.discounted_price = smart.discounted_price
                result.raw_discounted = smart.raw_discounted

        # CSS patterns as last-resort enrichment (fills fields still missing)
        if not result.price or not result.dealer_price or not result.title:
            common = await _try_common(page)
            if not result.price and common.price:
                result.price = common.price
                result.raw_price = common.raw_price
            if not result.discounted_price and common.discounted_price:
                result.discounted_price = common.discounted_price
                result.raw_discounted = common.raw_discounted
            if not result.dealer_price and common.dealer_price:
                result.dealer_price = common.dealer_price
                result.raw_dealer = common.raw_dealer
            if not result.title and common.title:
                result.title = common.title
            if result.stock_status in (None, "unknown") and common.stock_status not in (None, "unknown"):
                result.stock_status = common.stock_status

        # User overrides always last
        sel = config.selectors
        has_custom = any([
            sel.title, sel.price, sel.discounted_price, sel.dealer_price,
            sel.stock_status,
        ])
        if has_custom:
            result = await _apply_custom(page, config, result)

        if not result.stock_status:
            result.stock_status = "unknown"

        logger.info(
            "Scrape done: %s → price=%s disc=%s dealer=%s stock=%s",
            url, result.price, result.discounted_price,
            result.dealer_price, result.stock_status,
        )
        return result

    except Exception as e:
        logger.error("Scrape failed for %s: %s", url, e)
        return ScrapeResult(error=str(e))
    finally:
        await context.close()


# ── Probe (diagnostics) ──────────────────────────────────────────────────────

_PLATFORM_WAIT_FOR: dict[str, str] = {
    "cs-cart":     ".ty-price-num, .ty-price",
    "woocommerce": ".price .amount",
    "shopify":     ".price, [data-product-price]",
    "magento":     "[data-price-type='finalPrice'] .price, .price-box .price",
    "prestashop":  "#our_price_display, .current-price",
    "generic":     "",
}

_PLATFORM_SELECTORS: dict[str, dict[str, Optional[str]]] = {
    "cs-cart": {
        "title": ".ty-product-block-title",
        "price": ".ty-price-now .ty-price-num",
        "discounted_price": ".ty-price-retail-price .ty-price-num",
        "dealer_price": ".ty-price-dealer .ty-price-num",
        "stock_status": ".ty-qty-in-stock, .ty-qty-out-of-stock, .ty-special-msg",
    },
    "woocommerce": {
        "title": ".product_title",
        "price": ".price ins .amount, .price .amount",
        "discounted_price": ".price del .amount",
        "dealer_price": None,
        "stock_status": ".stock",
    },
    "shopify": {
        "title": ".product__title, h1[class*='product']",
        "price": ".price-item--sale, .price__regular .price-item",
        "discounted_price": ".price-item--regular, .price__compare",
        "dealer_price": None,
        "stock_status": ".product-form__inventory, [class*='inventory']",
    },
    "magento": {
        "title": ".page-title .base",
        "price": "[data-price-type='finalPrice'] .price, .price-box .price",
        "discounted_price": "[data-price-type='oldPrice'] .price",
        "dealer_price": None,
        "stock_status": ".stock.available, .stock.unavailable",
    },
    "prestashop": {
        "title": ".product_name, h1.product-name",
        "price": "#our_price_display, .current-price",
        "discounted_price": ".regular-price",
        "dealer_price": None,
        "stock_status": "#stock_availability, .availability",
    },
    "generic": {
        "title": None,
        "price": None,
        "discounted_price": None,
        "dealer_price": None,
        "stock_status": None,
    },
}


async def probe(url: str, config: ScrapeConfig) -> ProbeResponse:
    """
    Deep-dive diagnostics for a URL. Opens a Playwright context, runs every
    extraction strategy, and returns the raw candidates + detected platform.
    Useful for debugging why a site scrapes incorrectly.
    """
    response = ProbeResponse(url=url)
    context = await _open_context(config)
    page = await context.new_page()

    try:
        await _navigate(page, url, config)
        response.final_url = page.url

        # JSON-LD
        jsonld = await _try_json_ld(page)
        if jsonld.price or jsonld.title:
            response.json_ld_found = True
            response.json_ld_name = jsonld.title
            response.json_ld_price = jsonld.price

        # Smart scan + candidates
        data = await _run_smart_scan(page)
        response.platform = data.get("platform", "generic") or "generic"
        for c in data.get("candidates", []):
            response.candidates.append(ProbeCandidate(
                text=str(c.get("text", ""))[:80],
                value=c.get("value"),
                score=int(c.get("score", 0) or 0),
                font_size=c.get("font_size"),
                font_weight=c.get("font_weight"),
                struck=bool(c.get("struck", False)),
                dealer=bool(c.get("dealer", False)),
                dom_path=c.get("dom_path"),
            ))

        # Run the full scrape waterfall to compute an "extracted" snapshot
        extracted = await scrape_with_open_page(page, config, platform_hint=response.platform)
        response.extracted = extracted

        # Suggested config
        platform = response.platform if response.platform in _PLATFORM_SELECTORS else "generic"
        response.suggested_wait_for = _PLATFORM_WAIT_FOR.get(platform) or None
        response.suggested_selectors = dict(_PLATFORM_SELECTORS[platform])

        if not response.candidates:
            response.notes.append("No price-like text nodes found on this page.")
        if not extracted.price:
            response.notes.append(
                "No price could be extracted. Likely requires login "
                "(use /scraper/login-session) or a custom selector."
            )
        if extracted.stock_status == "unknown":
            response.notes.append(
                "Stock status could not be determined — "
                "add-to-cart button may be hidden behind login."
            )

        return response

    except Exception as e:
        logger.error("Probe failed for %s: %s", url, e)
        response.notes.append(f"Probe error: {e}")
        return response
    finally:
        await context.close()


async def scrape_with_open_page(
    page: Page, config: ScrapeConfig, platform_hint: Optional[str] = None
) -> ScrapeResult:
    """
    Run the full strategy waterfall on an already-open Page. Used by probe()
    to avoid re-navigating.
    """
    result = await _try_json_ld(page)
    if not result.price:
        result = await _try_microdata(page)

    if not result.price or result.stock_status in (None, "unknown"):
        smart = await _try_smart_scan(page)
        if not result.price and smart.price:
            preserved_title = result.title
            result = smart
            result.title = preserved_title or smart.title
        if result.stock_status in (None, "unknown") and smart.stock_status not in (None, "unknown"):
            result.stock_status = smart.stock_status
        if smart.dealer_price and not result.dealer_price:
            result.dealer_price = smart.dealer_price
            result.raw_dealer = smart.raw_dealer
        if smart.discounted_price and not result.discounted_price:
            result.discounted_price = smart.discounted_price
            result.raw_discounted = smart.raw_discounted

    if not result.price or not result.dealer_price or not result.title:
        common = await _try_common(page)
        if not result.price and common.price:
            result.price = common.price
            result.raw_price = common.raw_price
        if not result.discounted_price and common.discounted_price:
            result.discounted_price = common.discounted_price
            result.raw_discounted = common.raw_discounted
        if not result.dealer_price and common.dealer_price:
            result.dealer_price = common.dealer_price
            result.raw_dealer = common.raw_dealer
        if not result.title and common.title:
            result.title = common.title
        if result.stock_status in (None, "unknown") and common.stock_status not in (None, "unknown"):
            result.stock_status = common.stock_status

    sel = config.selectors
    has_custom = any([
        sel.title, sel.price, sel.discounted_price, sel.dealer_price,
        sel.stock_status,
    ])
    if has_custom:
        result = await _apply_custom(page, config, result)

    if not result.stock_status:
        result.stock_status = "unknown"

    return result


# ── Login helper ─────────────────────────────────────────────────────────────

async def save_login_state(
    url: str, save_path: str, headless: bool = False, wait_seconds: int = 180
) -> dict:
    """
    Open a non-headless Chromium window, let the user log in manually,
    then save the storage state (cookies + localStorage) to save_path.

    Returns a dict with status + final URL.
    """
    # Use a fresh Playwright instance in non-headless mode for the login flow.
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(
        headless=headless,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    )
    try:
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        page = await context.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)

        logger.info(
            "Login window open at %s. Browser will close in %ds — complete login now.",
            url, wait_seconds,
        )
        # Give the user up to wait_seconds to complete login in the opened window.
        await asyncio.sleep(wait_seconds)

        os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
        await context.storage_state(path=save_path)
        final_url = page.url
        return {"saved_to": save_path, "final_url": final_url}
    finally:
        await browser.close()
        await pw.stop()

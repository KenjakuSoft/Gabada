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
import re
import asyncio
import logging
from hashlib import sha1
from typing import Any, Optional

from app_paths import configure_runtime_environment, resolve_storage_state_path, sessions_dir
from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Playwright,
    Page,
)

from database.models import (
    BuyAreaItem,
    BuyAreaPick,
    ProbeCandidate,
    ProbeResponse,
    SelectorLabCandidate,
    SelectorLabProfile,
    SelectorLabResponse,
    ScrapeConfig,
    ScrapeResult,
)
from scraper.site_profiles import (
    PLATFORM_SELECTORS as _PLATFORM_SELECTORS,
    PLATFORM_WAIT_FOR as _PLATFORM_WAIT_FOR,
    apply_profile as _apply_site_profile,
    find_profile as _find_site_profile,
    normalize_hostname as _normalize_hostname,
)
from scraper import stealth as _stealth

logger = logging.getLogger(__name__)

_playwright: Optional[Playwright] = None
_browser: Optional[Browser] = None
_lock = asyncio.Lock()


async def start_browser() -> None:
    global _playwright, _browser
    configure_runtime_environment()
    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    )
    logger.info("Playwright browser started")


async def stop_browser() -> None:
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
_FREE_PRICE_RE = re.compile(
    r"\b(free|gratis|complimentary|no\s+charge)\b",
    re.IGNORECASE,
)
_FREE_PRICE_EXCLUSION_RE = re.compile(
    r"\btrial\b|\bfree\s+(?:demo|version|shipping|delivery|download|"
    r"software|utility|tool|support|updates?|upgrades?)\b",
    re.IGNORECASE,
)


def _is_installment_price(raw: Optional[str]) -> bool:
    return bool(raw and _INSTALLMENT_RE.search(raw))


def _is_free_price(raw: Optional[str]) -> bool:
    if not raw:
        return False
    return bool(_FREE_PRICE_RE.search(raw)) and not bool(
        _FREE_PRICE_EXCLUSION_RE.search(raw)
    )


# ── Price & stock parsers ─────────────────────────────────────────────────────

def _parse_price(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    if _is_installment_price(raw):
        return None
    if _FREE_PRICE_EXCLUSION_RE.search(raw):
        return None
    if _is_free_price(raw):
        return 0.0
    cleaned = re.sub(r"[^\d.,]", "", raw.strip())
    cleaned = cleaned.strip(".,")
    if not cleaned:
        return None
    # European format: 1.299,99
    if re.match(r"^\d{1,3}(\.\d{3})+(,\d+)?$", cleaned):
        cleaned = cleaned.replace(".", "").replace(",", ".")
    # US / Sri Lanka format: 1,299.99 or 55,500
    elif re.match(r"^\d{1,3}(,\d{3})+(\.\d+)?$", cleaned):
        cleaned = cleaned.replace(",", "")
    elif cleaned.count(",") and not cleaned.count("."):
        if re.match(r"^\d+,\d{1,2}$", cleaned):
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif cleaned.count(".") and not cleaned.count(","):
        if re.match(r"^\d{1,3}(\.\d{3})+$", cleaned):
            cleaned = cleaned.replace(".", "")
    else:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    try:
        v = float(cleaned)
        return v if v >= 0 else None
    except ValueError:
        return None


# Word-boundary regexes — substring matching on words like "expected" / "eta"
# causes false positives (e.g. "Expected delivery 2-3 days" on in-stock items).
_STOCK_PREORDER_RE = re.compile(
    r"\b(pre[\s-]?order(?:ing)?|pre[\s-]?sale|coming\s+soon|"
    r"available\s+for\s+pre[\s-]?order|will\s+be\s+available|"
    r"release(?:s|d)?\s+(?:on|in))\b",
    re.IGNORECASE,
)
_STOCK_BACKORDER_RE = re.compile(
    r"\b(back[\s-]?order(?:ed)?|on\s+back\s*order|onbackorder)\b",
    re.IGNORECASE,
)
_STOCK_CALL_PRICE_RE = re.compile(
    r"\b(call\s+for\s+price|call\s+us\s+for\s+price|ask\s+for\s+price|"
    r"price\s+on\s+request)\b",
    re.IGNORECASE,
)
_STOCK_CONTACT_RE = re.compile(
    r"\b(contact\s+us|contact\s+for\s+price|message\s+us|whatsapp\s+us|"
    r"inquire\s+now|send\s+inquiry)\b",
    re.IGNORECASE,
)
_STOCK_DISCONTINUED_RE = re.compile(
    r"\b(discontinued|end\s+of\s+life|eol)\b",
    re.IGNORECASE,
)
_STOCK_OUT_RE = re.compile(
    r"\b(out[\s-]?of[\s-]?stock|sold[\s-]?out|no\s+stock|not\s+available|"
    r"unavailable|outofstock|notify\s+me\s+when|"
    r"email\s+me\s+when)\b",
    re.IGNORECASE,
)
_STOCK_LIMITED_RE = re.compile(
    r"\b(limited\s+stock|limited\s+availability|limitedavailability|"
    r"low\s+stock|few\s+left|hurry|only\s+\d+\s+left)\b",
    re.IGNORECASE,
)
_STOCK_IN_RE = re.compile(
    r"\b(in[\s-]?stock|instock|available\s+now|ready\s+to\s+ship|"
    r"add\s+to\s+cart|buy\s+now)\b",
    re.IGNORECASE,
)
_STOCK_STATUS_PRIORITY = {
    "unknown": 0,
    "contact_store": 1,
    "in_stock": 2,
    "limited": 2,
    "preorder": 3,
    "backorder": 3,
    "call_for_price": 4,
    "discontinued": 5,
    "out_of_stock": 5,
}


def _should_replace_stock_status(
    current: Optional[str],
    candidate: Optional[str],
) -> bool:
    candidate = candidate or "unknown"
    current = current or "unknown"
    if candidate == "unknown" or candidate == current:
        return False
    if current == "unknown":
        return True
    return _STOCK_STATUS_PRIORITY.get(candidate, 1) > _STOCK_STATUS_PRIORITY.get(
        current,
        1,
    )


def _parse_stock(raw: Optional[str]) -> str:
    if not raw:
        return "unknown"
    t = raw.strip()
    first_line = next((line.strip() for line in t.splitlines() if line.strip()), "")
    if re.search(
        r"\b(?:availability|stock)\s*:?\s*(?:no|false|0)\b",
        t,
        re.IGNORECASE,
    ):
        return "out_of_stock"
    if re.search(
        r"\b(?:availability|stock)\s*:?\s*(?:yes|true|1)\b",
        t,
        re.IGNORECASE,
    ):
        return "in_stock"
    if first_line and len(first_line) <= 80:
        if _STOCK_CALL_PRICE_RE.search(first_line):
            return "call_for_price"
        if _STOCK_DISCONTINUED_RE.search(first_line):
            return "discontinued"
        if _STOCK_OUT_RE.search(first_line):
            return "out_of_stock"
        if _STOCK_PREORDER_RE.search(first_line):
            return "preorder"
        if _STOCK_BACKORDER_RE.search(first_line):
            return "backorder"
        if _STOCK_LIMITED_RE.search(first_line):
            return "limited"
        if _STOCK_IN_RE.search(first_line):
            return "in_stock"
    # Order matters: preorder / backorder BEFORE in-stock, because those pages
    # often also show "available" / "add to cart" copy.
    if _STOCK_CALL_PRICE_RE.search(t):
        return "call_for_price"
    if _STOCK_CONTACT_RE.search(t):
        return "contact_store"
    if _STOCK_DISCONTINUED_RE.search(t):
        return "discontinued"
    if _STOCK_PREORDER_RE.search(t):
        return "preorder"
    if _STOCK_BACKORDER_RE.search(t):
        return "backorder"
    if _STOCK_OUT_RE.search(t):
        return "out_of_stock"
    if _STOCK_LIMITED_RE.search(t):
        return "limited"
    if _STOCK_IN_RE.search(t):
        return "in_stock"
    # Bare "available" as a fallback — kept last to avoid stomping on
    # negative phrases like "not available" matched above.
    if re.search(r"\bavailable\b", t, re.IGNORECASE):
        return "in_stock"
    return "unknown"


def _stock_from_schema_url(url: str) -> str:
    url = url.lower()
    if "discontinued" in url:
        return "discontinued"
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


_PRODUCT_ROOT_SELECTORS = [
    "div.summary.entry-summary",
    ".summary.entry-summary",
    "#product .summary",
    ".product-details-area",
    ".product-view-area",
    ".ty-product-block",
    ".ty-productPage-body",
    ".ty-productPage",
    "#product-info-main",
    ".product__info-container",
    ".product-single__info",
    ".product-page",
    "article.product",
    "[itemtype*='Product']",
]


# Anchor-based buy-box detector. Runs in the page so it can read computed
# styles, visibility, and inner text without round-tripping each candidate.
#
# Strategy:
#   1. Try the well-known PRODUCT_ROOT class/ID selectors above first.
#   2. Otherwise pick the longest visible H1/title-like element as the anchor
#      and walk up at most 8 ancestors looking for one that contains BOTH
#      an add-to-cart-style control AND price-looking digits.
#
# The "must contain add-to-cart AND a price" filter is what stops this from
# matching the page header, related-products grid, or footer banners.
# Returns ``null`` when no confident buy-box can be located, in which case
# the engine intentionally falls back to looser scoping rather than guess.
_BUY_BOX_DETECTOR_JS = r"""() => {
    function visible(el) {
        if (!el) return false;
        try {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden'
                && parseFloat(s.opacity || '1') > 0;
        } catch (_) { return true; }
    }

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function hasPriceText(value) {
        const text = normalizeText(value);
        // Accept either a numeric price or a non-numeric "price qualifier"
        // (Free, Coming Soon, Game Trial, Pre-order, Included). Without
        // the qualifier branch, PS Store free-with-PS-Plus pages and Epic
        // "Coming Soon" listings fail buy-box detection because the
        // visible buy area has no currency-prefixed digits to anchor on.
        return /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?/.test(text)
            || /(?:rs\.?|lkr|\$|€|£|¥|₹|฿)\s*\d+(?:\.\d{1,2})?/i.test(text)
            || /\b(?:free|included(?:\s+with)?|coming\s+soon|pre[\s-]?order|game\s+trial|trial\s+available)\b/i.test(text);
    }

    function isEpicStoreHost() {
        return /(?:^|\.)epicgames\.com$/i.test(window.location.hostname || '');
    }

    const ADD_TO_CART_SELECTOR = [
        'button[type="submit"]',
        '.add-to-cart',
        '.single_add_to_cart_button',
        '.buy-now',
        '#add-to-cart-button',
        '[data-action*="cart"]',
        '[class*="add-to-cart"]',
        '[class*="addtocart"]',
        '[class*="AddToCart"]',
        '[class*="buy-now"]',
        '[class*="buynow"]',
        'button[name*="cart"]',
        'button[name*="add-to-cart"]',
        'form.cart button',
        'form[action*="cart"] button',
        'a[href*="add-to-cart"]',
        '[data-qa*="cart" i]',
        '[data-qa*="buy" i]',
        '[data-qa*="purchase" i]',
        '[data-qa*="add-to-library" i]',
        '[data-qa*="add-to-bag" i]',
        '[data-testid*="cart" i]',
        '[data-testid*="buy" i]',
        '[data-testid*="purchase" i]',
        '[data-testid*="add-to-library" i]',
        '[aria-label*="add to cart" i]',
        '[aria-label*="buy now" i]',
        '[aria-label*="add to library" i]',
        '[aria-label*="add to bag" i]',
        '[aria-label*="purchase" i]',
    ].join(', ');
    const PURCHASE_TEXT = /\b(add[\s-]?to[\s-]?cart|buy[\s-]?now|purchase|checkout|pre[\s-]?(?:purchase|order)|order[\s-]?now)\b/i;

    function focusedPurchaseRoot() {
        const candidates = [];
        for (const control of document.querySelectorAll(ADD_TO_CART_SELECTOR)) {
            if (!visible(control)) continue;
            const controlText = normalizeText(
                (control.innerText || control.textContent || '') + ' ' +
                (control.getAttribute('aria-label') || '') + ' ' +
                (control.getAttribute('data-testid') || '') + ' ' +
                (control.getAttribute('data-qa') || '')
            );
            if (!PURCHASE_TEXT.test(controlText)) continue;
            const priority = /\b(buy[\s-]?now|purchase|checkout|pre[\s-]?(?:purchase|order)|order[\s-]?now)\b/i.test(controlText)
                ? 0
                : 1;
            let cur = control.parentElement;
            for (let depth = 0; depth < 8 && cur; depth += 1, cur = cur.parentElement) {
                if (!cur.querySelectorAll) continue;
                const innerText = normalizeText(cur.innerText || cur.textContent || '');
                if (!innerText || innerText.length < 20 || innerText.length > 8000) continue;
                if (!hasPriceText(innerText)) continue;
                candidates.push({ el: cur, priority, depth, len: innerText.length });
            }
        }
        candidates.sort((a, b) => a.priority - b.priority || a.len - b.len || a.depth - b.depth);
        return candidates[0]?.el || null;
    }

    if (isEpicStoreHost()) {
        const focused = focusedPurchaseRoot();
        if (focused) return focused;
    }

    const PRODUCT_ROOT_SELECTORS = [
        'div.summary.entry-summary',
        '.summary.entry-summary',
        '#product .summary',
        '.product-details-area',
        '.product-view-area',
        '.ty-product-block',
        '.ty-productPage-body',
        '.ty-productPage',
        '#product-info-main',
        '.product__info-container',
        '.product-single__info',
        '.product-page',
        'article.product',
        '[itemtype*="Product"]',
    ];
    for (const selector of PRODUCT_ROOT_SELECTORS) {
        const found = document.querySelector(selector);
        if (
            found
            && visible(found)
            && hasPriceText(found.innerText || found.textContent || '')
        ) return found;
    }

    // Anchor: the longest visible product-title node on the page.
    const titleSelectors = [
        'h1.product_title',
        'h1.product-title',
        'h1.product-name',
        '.product_title',
        '.product-title',
        '.product-name',
        '[itemprop="name"]',
        'h1',
    ];
    let anchor = null;
    let bestLen = 0;
    for (const sel of titleSelectors) {
        for (const el of document.querySelectorAll(sel)) {
            if (!visible(el)) continue;
            const text = normalizeText(el.textContent || '');
            if (text.length < 8) continue;
            if (text.length > bestLen) {
                bestLen = text.length;
                anchor = el;
            }
        }
        if (anchor) break;
    }
    if (!anchor) return null;

    // Walk up at most 8 ancestors looking for the buy-box. Required:
    //  - moderate text size (filters out tiny carousels and the body itself)
    //  - an add-to-cart control inside this subtree
    //  - at least one price-looking number inside this subtree
    let cur = anchor;
    for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
        if (!cur.querySelectorAll) continue;
        const innerText = normalizeText(cur.innerText || '');
        if (!innerText || innerText.length < 60 || innerText.length > 18000) continue;
        const hasAddToCart = !!cur.querySelector(ADD_TO_CART_SELECTOR);
        if (!hasAddToCart) continue;
        if (!hasPriceText(innerText)) continue;
        return cur;
    }
    return null;
}"""


async def _get_product_root(page: Page):
    """Locate the product buy-box / price-box on the page.

    Returns an ``ElementHandle`` for the smallest container that holds the
    product title + add-to-cart control + price digits, or ``None`` when no
    confident buy-box can be found. Callers use the returned handle to scope
    selector queries so they cannot match prices in related-products,
    recently-viewed, mini-cart, or footer regions.

    Tries the JS anchor-based detector first because it validates that a
    candidate root actually contains price-looking text. That distinction
    matters for templates where ``.summary.entry-summary`` exists but the
    visible price sits in a sibling container. Falls back to the original
    class-selector list only when the JS evaluator itself fails.
    """
    try:
        handle = await page.evaluate_handle(_BUY_BOX_DETECTOR_JS)
    except Exception as e:
        logger.debug("Buy-box detector failed: %s", e)
        handle = None
    if handle is not None:
        try:
            element = handle.as_element()
        except Exception:
            element = None
        if element is not None:
            return element
        try:
            await handle.dispose()
        except Exception:
            pass
        return None

    for selector in _PRODUCT_ROOT_SELECTORS:
        try:
            root = await page.query_selector(selector)
        except Exception:
            continue
        if root:
            return root
    return None


# Buy-area content dump.
#
# Phase 1 of the "self-adaptive scraper" rework: instead of forcing every
# product page through the price / discounted_price / dealer_price slots,
# return EVERYTHING in the detected buy-box with its visible text and a
# best-guess role (title / price / qualifier / badge / label / stock /
# image). Storefronts with non-numeric "prices" (PlayStation Store's
# "Free with PS Plus" and "Game Trial", Xbox's "Included with Game Pass",
# Epic's "Coming Soon") become representable as ``kind="price"`` items
# with ``value=None`` and a ``qualifier`` string.
#
# This runs additionally to the existing waterfall — it doesn't replace
# extraction. Probe and Selector Lab surface it so the user can see what
# the scraper actually saw, then later phases will let them pin one item
# as the value to track per product_store.
_BUY_AREA_DUMP_JS = r"""() => {
    function visible(el) {
        if (!el) return false;
        try {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden'
                && parseFloat(s.opacity || '1') > 0;
        } catch (_) { return true; }
    }
    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    // ── Buy-box anchor (same logic as _BUY_BOX_DETECTOR_JS) ──
    const PRODUCT_ROOT_SELECTORS = [
        'div.summary.entry-summary',
        '.summary.entry-summary',
        '#product .summary',
        '.product-details-area',
        '.product-view-area',
        '.ty-product-block',
        '.ty-productPage-body',
        '.ty-productPage',
        '#product-info-main',
        '.product__info-container',
        '.product-single__info',
        '.product-page',
        'article.product',
        '[itemtype*="Product"]',
    ];

    function hasPriceText(value) {
        const text = normalizeText(value);
        return /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?/.test(text)
            || /(?:rs\.?|lkr|\$|€|£|¥|₹|฿)\s*\d+(?:\.\d{1,2})?/i.test(text)
            || /\b(?:free|included(?:\s+with)?|coming\s+soon|pre[\s-]?order|game\s+trial|trial\s+available)\b/i.test(text);
    }

    function isEpicStoreHost() {
        return /(?:^|\.)epicgames\.com$/i.test(window.location.hostname || '');
    }

    const ADD_TO_CART_SELECTOR = [
        'button[type="submit"]',
        '.add-to-cart',
        '.single_add_to_cart_button',
        '.buy-now',
        '#add-to-cart-button',
        '[data-action*="cart"]',
        '[class*="add-to-cart"]',
        '[class*="addtocart"]',
        '[class*="AddToCart"]',
        '[class*="buy-now"]',
        '[class*="buynow"]',
        'button[name*="cart"]',
        'button[name*="add-to-cart"]',
        'form.cart button',
        'form[action*="cart"] button',
        'a[href*="add-to-cart"]',
        '[data-qa*="cart" i]',
        '[data-qa*="buy" i]',
        '[data-qa*="purchase" i]',
        '[data-qa*="add-to-library" i]',
        '[data-qa*="add-to-bag" i]',
        '[data-testid*="cart" i]',
        '[data-testid*="buy" i]',
        '[data-testid*="purchase" i]',
        '[data-testid*="add-to-library" i]',
        '[aria-label*="add to cart" i]',
        '[aria-label*="buy now" i]',
        '[aria-label*="add to library" i]',
        '[aria-label*="add to bag" i]',
        '[aria-label*="purchase" i]',
    ].join(', ');
    const PURCHASE_TEXT = /\b(add[\s-]?to[\s-]?cart|buy[\s-]?now|purchase|checkout|pre[\s-]?(?:purchase|order)|order[\s-]?now)\b/i;

    function focusedPurchaseRoot() {
        const candidates = [];
        for (const control of document.querySelectorAll(ADD_TO_CART_SELECTOR)) {
            if (!visible(control)) continue;
            const controlText = normalizeText(
                (control.innerText || control.textContent || '') + ' ' +
                (control.getAttribute('aria-label') || '') + ' ' +
                (control.getAttribute('data-testid') || '') + ' ' +
                (control.getAttribute('data-qa') || '')
            );
            if (!PURCHASE_TEXT.test(controlText)) continue;
            const priority = /\b(buy[\s-]?now|purchase|checkout|pre[\s-]?(?:purchase|order)|order[\s-]?now)\b/i.test(controlText)
                ? 0
                : 1;
            let cur = control.parentElement;
            for (let depth = 0; depth < 8 && cur; depth += 1, cur = cur.parentElement) {
                if (!cur.querySelectorAll) continue;
                const innerText = normalizeText(cur.innerText || cur.textContent || '');
                if (!innerText || innerText.length < 20 || innerText.length > 8000) continue;
                if (!hasPriceText(innerText)) continue;
                candidates.push({ el: cur, priority, depth, len: innerText.length });
            }
        }
        candidates.sort((a, b) => a.priority - b.priority || a.len - b.len || a.depth - b.depth);
        return candidates[0]?.el || null;
    }

    let buyBox = null;
    if (isEpicStoreHost()) {
        buyBox = focusedPurchaseRoot();
    }
    for (const sel of PRODUCT_ROOT_SELECTORS) {
        if (buyBox) break;
        const found = document.querySelector(sel);
        if (found && visible(found)) { buyBox = found; break; }
    }
    if (!buyBox) {
        const titleSelectors = [
            'h1.product_title', 'h1.product-title', 'h1.product-name',
            '.product_title', '.product-title', '.product-name',
            '[itemprop="name"]', 'h1',
        ];
        let anchor = null, bestLen = 0;
        for (const sel of titleSelectors) {
            for (const el of document.querySelectorAll(sel)) {
                if (!visible(el)) continue;
                const text = normalizeText(el.textContent || '');
                if (text.length < 8) continue;
                if (text.length > bestLen) { bestLen = text.length; anchor = el; }
            }
            if (anchor) break;
        }
        if (anchor) {
            let cur = anchor;
            for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
                if (!cur.querySelectorAll) continue;
                const innerText = normalizeText(cur.innerText || '');
                if (!innerText || innerText.length < 60 || innerText.length > 18000) continue;
                const hasAddToCart = !!cur.querySelector(ADD_TO_CART_SELECTOR);
                if (!hasAddToCart) continue;
                if (!hasPriceText(innerText)) continue;
                buyBox = cur;
                break;
            }
        }
    }
    if (!buyBox) return { root_selector: null, items: [] };

    function rootSelector(el) {
        if (!el) return null;
        if (el.id) return '#' + el.id;
        const tag = el.tagName.toLowerCase();
        const classes = (typeof el.className === 'string' ? el.className : '')
            .split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        return classes ? `${tag}.${classes}` : tag;
    }

    function escapeCss(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    function elementSelector(el) {
        if (!el || !el.tagName) return null;
        if (el.id) return '#' + escapeCss(el.id);
        const parts = [];
        let cur = el;
        for (let i = 0; i < 5 && cur && cur.tagName; i += 1, cur = cur.parentElement) {
            let part = cur.tagName.toLowerCase();
            const classes = (typeof cur.className === 'string' ? cur.className : '')
                .split(/\s+/).filter(Boolean).slice(0, 2);
            if (classes.length) part += '.' + classes.map(escapeCss).join('.');
            if (cur.parentElement) {
                const siblings = Array.from(cur.parentElement.children)
                    .filter((s) => s.tagName === cur.tagName);
                if (siblings.length > 1) {
                    part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
                }
            }
            parts.unshift(part);
            if (classes.length) break;
        }
        return parts.join(' > ');
    }

    function domPath(el) {
        const parts = [];
        let cur = el;
        for (let i = 0; i < 4 && cur; i += 1, cur = cur.parentElement) {
            const cls = (typeof cur.className === 'string' ? cur.className : '')
                .split(/\s+/).filter(Boolean).slice(0, 2).join('.');
            parts.push(cur.tagName.toLowerCase() + (cls ? '.' + cls : ''));
        }
        return parts.reverse().join(' > ');
    }

    function isStruck(el) {
        let cur = el;
        for (let i = 0; i < 5 && cur; i += 1, cur = cur.parentElement) {
            const t = cur.tagName;
            if (t === 'DEL' || t === 'S' || t === 'STRIKE') return true;
            try {
                const td = window.getComputedStyle(cur).textDecorationLine
                    || window.getComputedStyle(cur).textDecoration || '';
                if (td.includes('line-through')) return true;
            } catch (_) {}
            const info = ((cur.className || '') + ' ' + (cur.id || '')).toString();
            if (/\b(retail|was|original|old|regular|strike|crossed|del-price|list-price|mrp|rrp|msrp|line-through|strikethrough)\b/i.test(info)) {
                return true;
            }
        }
        return false;
    }

    // ── Classifiers ──
    const CURRENCY_SIGNAL = /(?:\b(?:rs\.?|lkr|usd|aed|sgd|myr|inr|php|bdt|eur|gbp|jpy|aud|cad)\b|රු|\/=|\$|€|£|¥|฿|₹|₽)/i;
    const PRICE_NUMERIC = /\d[\d,]*(?:\.\d{1,2})?/;
    const FREE_PHRASE = /\b(free|gratis|complimentary|no\s+charge)\b/i;
    const TRIAL_PHRASE = /\b(game\s+trial|trial\s+available|free\s+trial|trial)\b/i;
    const SUB_PHRASE = /\b(?:included\s+with[\w\s+'-]*|with\s+(?:ps\s*plus|playstation\s*plus|gold|game\s*pass|prime|hbo|netflix|game\s*plus)|subscriber\s*price|members?\s+price|members?\s+only)\b/i;
    const COMING_SOON = /\b(coming\s+soon|releases?\s+(?:on|in)\s+|available\s+\w+\s+\d|pre[\s-]?order(?:\s+now)?|notify\s+me)\b/i;
    const BADGE_EXACT = /^(?:[-−]\s*\d+\s*%(?:\s*off)?|sale|new|hot|deal|best\s*seller|limited|exclusive|featured|popular|trending)$/i;
    const PERCENT_OFF = /[-−]\s*\d+\s*%/;
    const STOCK_VERBS = /\b(add[\s-]?to[\s-]?cart|buy[\s-]?now|order[\s-]?now|purchase|checkout|shop[\s-]?now|out[\s-]?of[\s-]?stock|sold[\s-]?out|unavailable|notify\s*me|pre[\s-]?order|in[\s-]?stock)\b/i;

    function ownText(el) {
        const parts = [];
        for (const node of el.childNodes) {
            if (node.nodeType === 3) {
                parts.push(node.textContent || '');
            }
        }
        return normalizeText(parts.join(''));
    }

    function classify(el, text) {
        if (!text) return null;
        const tag = (el.tagName || '').toLowerCase();
        const isButton = tag === 'button' || tag === 'input'
            || el.getAttribute('role') === 'button';
        const itemprop = (el.getAttribute('itemprop') || '').toLowerCase();
        const isHeading = /^h[1-3]$/.test(tag) || itemprop === 'name';

        if (tag === 'img') {
            const src = el.currentSrc || el.getAttribute('src') || '';
            if (!src || src.startsWith('data:')) return null;
            return { kind: 'image', text: src };
        }

        if (isHeading && text.length >= 4 && text.length <= 240) {
            return { kind: 'title', text };
        }

        if (isButton && STOCK_VERBS.test(text)) {
            return {
                kind: 'stock',
                text,
                is_button: true,
                is_disabled: el.disabled === true
                    || el.getAttribute('disabled') !== null
                    || el.getAttribute('aria-disabled') === 'true',
            };
        }

        // Compact promo/sale callouts.
        if (text.length <= 24 && (BADGE_EXACT.test(text) || PERCENT_OFF.test(text))) {
            return { kind: 'badge', text };
        }

        // Non-numeric prices: "Free with PS Plus", "Game Trial", "Included
        // with Game Pass", "Coming Soon", "Pre-order".
        if (text.length <= 80) {
            if (FREE_PHRASE.test(text) || TRIAL_PHRASE.test(text)
                || SUB_PHRASE.test(text) || COMING_SOON.test(text)) {
                return { kind: 'price', text, value: null, qualifier: text };
            }
        }

        // Numeric price.
        const m = text.match(PRICE_NUMERIC);
        if (m && text.length <= 80) {
            const hasCurrency = CURRENCY_SIGNAL.test(text);
            const value = parseFloat(m[0].replace(/,/g, ''));
            if (!isNaN(value) && value > 0 && value < 50_000_000) {
                // Exclude bare percentages and small standalone integers
                // when there is no currency context.
                if (!hasCurrency && /^\d{1,2}\s*%/.test(text)) return null;
                if (!hasCurrency && value < 100) return null;
                return { kind: 'price', text, value };
            }
        }

        // Stock-like text without a button context.
        if (text.length <= 60 && STOCK_VERBS.test(text)) {
            return { kind: 'stock', text, is_button: false };
        }

        // Short, non-empty leftover text near other items becomes a label.
        if (text.length >= 1 && text.length <= 80) {
            return { kind: 'label', text };
        }
        return null;
    }

    // ── DOM walk: emit one item per element with non-empty own text. ──
    const items = [];
    const walker = document.createTreeWalker(buyBox, NodeFilter.SHOW_ELEMENT);
    let order = 0;
    let node = walker.currentNode;
    while (node) {
        const el = node;
        node = walker.nextNode();
        if (!el || el === buyBox) continue;
        if (!visible(el)) continue;
        const tag = (el.tagName || '').toLowerCase();
        if (['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link', 'template'].includes(tag)) continue;

        // Take own text (excluding descendants') so a parent .price node
        // doesn't double-emit text that already came from its <del>/<ins>
        // children.
        let text = ownText(el);
        if (!text && tag === 'img') text = '__image__';
        if (!text && (tag === 'button' || tag === 'input' || tag === 'a')) {
            // Form controls often have child spans for icons; fall back
            // to innerText so we still capture "Add to Cart".
            const inner = normalizeText(el.innerText || el.textContent || '');
            if (inner && inner.length <= 60) text = inner;
        }
        if (!text) continue;

        const classified = classify(el, text);
        if (!classified) continue;

        let fontSize = null, fontWeight = null;
        try {
            const cs = window.getComputedStyle(el);
            fontSize = parseFloat(cs.fontSize) || null;
            fontWeight = parseInt(cs.fontWeight, 10) || null;
        } catch (_) {}

        items.push({
            kind: classified.kind,
            text: classified.text || text,
            value: classified.value !== undefined ? classified.value : null,
            qualifier: classified.qualifier || null,
            selector: elementSelector(el),
            dom_path: domPath(el),
            tag,
            struck: isStruck(el),
            is_button: !!classified.is_button,
            is_disabled: !!classified.is_disabled,
            font_size: fontSize,
            font_weight: fontWeight,
            order: order++,
        });
    }

    // ── Post-pass: associate labels and badges with neighbouring prices. ──
    function findNearestPrice(start, dir) {
        let i = start + dir;
        const limit = dir > 0 ? items.length : -1;
        while (i !== limit) {
            const it = items[i];
            if (it.kind === 'price') return it;
            // Stop at structural breaks.
            if (it.kind === 'title' || it.kind === 'stock') break;
            i += dir;
        }
        return null;
    }

    for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        if (it.kind === 'price') {
            // Walk back for the most-recent label.
            for (let j = i - 1; j >= Math.max(0, i - 4); j -= 1) {
                if (items[j].kind === 'label') {
                    it.label_before = items[j].text;
                    break;
                }
                if (items[j].kind === 'price' || items[j].kind === 'title') break;
            }
            for (let j = i + 1; j < Math.min(items.length, i + 4); j += 1) {
                if (items[j].kind === 'label') {
                    it.label_after = items[j].text;
                    break;
                }
                if (items[j].kind === 'price' || items[j].kind === 'stock') break;
            }
            it.near_badges = [];
            for (let j = Math.max(0, i - 3); j <= Math.min(items.length - 1, i + 3); j += 1) {
                if (j === i) continue;
                if (items[j].kind === 'badge') it.near_badges.push(items[j].text);
            }
        } else if (it.kind === 'badge') {
            const before = findNearestPrice(i, -1);
            const after = findNearestPrice(i, +1);
            const pick = (before && after)
                ? (Math.abs(items.indexOf(before) - i) <= Math.abs(items.indexOf(after) - i) ? before : after)
                : (before || after);
            if (pick) it.near_price = pick.text;
        }
    }

    return { root_selector: rootSelector(buyBox), items };
}"""


async def _run_buy_area_dump(page: Page) -> dict:
    """Run the buy-area dump JS and normalise its return shape."""
    try:
        data = await page.evaluate(_BUY_AREA_DUMP_JS)
    except Exception as e:
        logger.debug("Buy-area dump error: %s", e)
        return {"root_selector": None, "items": []}
    if not isinstance(data, dict):
        return {"root_selector": None, "items": []}
    items = data.get("items")
    if not isinstance(items, list):
        items = []
    return {
        "root_selector": data.get("root_selector"),
        "items": items,
    }


_ALLOWED_BUY_AREA_KINDS = {
    "title",
    "price",
    "qualifier",
    "badge",
    "label",
    "stock",
    "image",
    "other",
}


def _coerce_buy_area_items(raw_items: list[Any]) -> list[BuyAreaItem]:
    """Convert raw JS-side buy-area dump entries into ``BuyAreaItem`` rows.

    Defensive: silently drops entries that fail validation so a single
    quirky DOM node never sinks the whole probe response.
    """
    items: list[BuyAreaItem] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind") or "").strip().lower()
        if kind not in _ALLOWED_BUY_AREA_KINDS:
            kind = "other"
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        near_badges_raw = raw.get("near_badges") or []
        if not isinstance(near_badges_raw, list):
            near_badges_raw = []
        try:
            items.append(
                BuyAreaItem(
                    kind=kind,
                    text=text[:240],
                    value=raw.get("value") if isinstance(raw.get("value"), (int, float)) else None,
                    qualifier=str(raw["qualifier"])[:160] if raw.get("qualifier") else None,
                    selector=str(raw["selector"])[:240] if raw.get("selector") else None,
                    dom_path=str(raw["dom_path"])[:240] if raw.get("dom_path") else None,
                    tag=str(raw["tag"])[:24] if raw.get("tag") else None,
                    struck=bool(raw.get("struck")),
                    is_button=bool(raw.get("is_button")),
                    is_disabled=bool(raw.get("is_disabled")),
                    font_size=raw.get("font_size") if isinstance(raw.get("font_size"), (int, float)) else None,
                    font_weight=int(raw["font_weight"]) if isinstance(raw.get("font_weight"), (int, float)) else None,
                    order=int(raw.get("order") or len(items)),
                    label_before=str(raw["label_before"])[:160] if raw.get("label_before") else None,
                    label_after=str(raw["label_after"])[:160] if raw.get("label_after") else None,
                    near_badges=[str(b)[:60] for b in near_badges_raw if b],
                    near_price=str(raw["near_price"])[:160] if raw.get("near_price") else None,
                )
            )
        except Exception as exc:
            logger.debug("Skipping malformed buy-area item: %s", exc)
            continue
    return items


# ── Buy-area pick replay (Phase 2a) ──────────────────────────────────────────
#
# A ``BuyAreaPick`` is the user's decision: "track THIS specific item I see in
# the Selector Lab as the price (or discounted_price / dealer_price /
# stock_status / title) for this product." At scrape time we re-run the buy-
# area dump and score every current item against the saved fingerprint, then
# adopt the best match (above a confidence threshold) as that field's value.
#
# Scoring is heuristic on purpose so layout churn within a theme doesn't break
# the mapping. Selector match is the strongest signal but a class rotation
# alone won't be fatal as long as the item still sits next to the same label,
# carries the same qualifier, or has the same DOM-path shape.

# Minimum total score required for a pick to apply. Values below this leave
# the existing waterfall result alone and surface a "site changed, please
# re-pick" review note. Tuned so a pick that matches by selector OR by any
# two soft signals (kind + label_before, qualifier + dom_path) still applies.
_BUY_AREA_PICK_MIN_SCORE = 30

# Maximum value drift tolerated before the value-similarity bonus drops off,
# expressed as a fraction. A pinned price of 1000 still scores the bonus when
# the live item is anywhere from 950 to 1050.
_BUY_AREA_VALUE_TOLERANCE = 0.05


def _buy_area_pick_score(pick: BuyAreaPick, item: BuyAreaItem) -> int:
    """Heuristic similarity score between a saved pick and a live item.

    Higher is better. Components:
      * Same exact selector              +50
      * Same dom_path                    +20
      * Same kind                        +10
      * Same qualifier                   +15
      * Same label_before                +10
      * Same label_after                 +10
      * Numeric value within 5%          +5
    """
    score = 0
    if pick.selector and item.selector and pick.selector == item.selector:
        score += 50
    if pick.dom_path and item.dom_path and pick.dom_path == item.dom_path:
        score += 20
    if pick.kind and item.kind and pick.kind == item.kind:
        score += 10
    if pick.qualifier and item.qualifier and pick.qualifier == item.qualifier:
        score += 15
    if pick.label_before and item.label_before and pick.label_before == item.label_before:
        score += 10
    if pick.label_after and item.label_after and pick.label_after == item.label_after:
        score += 10
    if pick.value is not None and item.value is not None:
        low = min(abs(pick.value), abs(item.value))
        if low > 0:
            drift = abs(pick.value - item.value) / max(low, 1.0)
            if drift <= _BUY_AREA_VALUE_TOLERANCE:
                score += 5
    return score


def _best_match_for_pick(
    pick: BuyAreaPick,
    items: list[BuyAreaItem],
) -> tuple[Optional[BuyAreaItem], int]:
    """Return the highest-scoring live item for a pick (or ``None, 0``)."""
    best: Optional[BuyAreaItem] = None
    best_score = 0
    for item in items:
        score = _buy_area_pick_score(pick, item)
        if score > best_score:
            best_score = score
            best = item
    return best, best_score


def _apply_buy_area_picks(
    result: ScrapeResult,
    picks: list[BuyAreaPick],
    items: list[BuyAreaItem],
) -> ScrapeResult:
    """Override extracted fields where a saved pick matches a live item.

    Mutates and returns ``result``. Picks that fail to match (best score
    below threshold) leave the field alone and add a review note pointing
    the user back to the Selector Lab.
    """
    if not picks:
        return result
    if not items:
        # No live buy-area to match against — almost certainly a partial
        # bot block. Surface this clearly so the user knows their pinned
        # picks didn't apply (rather than silently shipping waterfall data).
        _add_review_note(
            result,
            "Saved buy-area picks could not be replayed — the buy-area was "
            "not visible on this scrape (page may be partially blocked). "
            "Falling back to the standard extraction.",
        )
        if result.review_status == "ok":
            result.review_status = "needs_review"
        return result

    for pick in picks:
        target = (pick.target_field or "").strip()
        if target not in {"price", "discounted_price", "dealer_price", "stock_status", "title"}:
            continue
        match, score = _best_match_for_pick(pick, items)
        if match is None or score < _BUY_AREA_PICK_MIN_SCORE:
            _add_review_note(
                result,
                f"Buy-area pick for {target!r} could not be matched on this "
                f"scrape (best score {score}). Site layout may have changed "
                "— re-pin the item in Selector Lab.",
            )
            if result.review_status == "ok":
                result.review_status = "needs_review"
            continue

        if target == "title":
            result.title = match.text or result.title
            continue
        if target == "stock_status":
            # Treat the picked item's text as the source of truth and
            # reuse the existing parser for normalisation.
            parsed = _parse_stock(match.text)
            if parsed != "unknown":
                result.stock_status = parsed
            continue
        # Numeric fields: use parsed/free text first, then the captured
        # numeric value. This lets visible "Free" flow through as 0.0.
        parsed_value = _parse_price(match.qualifier or match.text)
        value = parsed_value if parsed_value is not None else match.value
        if value is None:
            _add_review_note(
                result,
                f"Buy-area pick for {target!r} matched a non-numeric item "
                f"({match.qualifier or match.text!r}); leaving the field "
                "blank for this scrape.",
            )
            if target == "price":
                result.price = None
                result.raw_price = None
            elif target == "discounted_price":
                result.discounted_price = None
                result.raw_discounted = None
            elif target == "dealer_price":
                result.dealer_price = None
                result.raw_dealer = None
            continue
        if target == "price":
            result.price = value
            result.raw_price = match.text
        elif target == "discounted_price":
            result.discounted_price = value
            result.raw_discounted = match.text
        elif target == "dealer_price":
            result.dealer_price = value
            result.raw_dealer = match.text
    return _normalize_scrape_result(result)


async def _query_selector_scoped(
    page: Page,
    selector: Optional[str],
    *,
    root=None,
    allow_page_fallback: bool = True,
):
    if not selector:
        return None
    if root is not None:
        try:
            el = await root.query_selector(selector)
        except Exception:
            el = None
        if el or not allow_page_fallback:
            return el
    try:
        return await page.query_selector(selector)
    except Exception:
        return None


async def _query_selector_all_scoped(
    page: Page,
    selector: Optional[str],
    *,
    root=None,
    allow_page_fallback: bool = True,
):
    if not selector:
        return []
    if root is not None:
        try:
            els = await root.query_selector_all(selector)
        except Exception:
            els = []
        if els or not allow_page_fallback:
            return els
    try:
        return await page.query_selector_all(selector)
    except Exception:
        return []


async def _read_element_text(el) -> Optional[str]:
    if not el:
        return None
    try:
        raw = await el.get_attribute("content")
        if raw:
            raw = raw.strip()
            if raw:
                return raw
    except Exception:
        pass
    try:
        raw = await el.inner_text()
    except Exception:
        return None
    raw = (raw or "").strip()
    return raw or None


def _clear_discount(result: ScrapeResult) -> None:
    result.discounted_price = None
    result.raw_discounted = None


def _normalize_scrape_result(result: ScrapeResult) -> ScrapeResult:
    """Keep ``price`` as regular and ``discounted_price`` as current sale."""
    if result.price is None and result.discounted_price is not None:
        result.price = result.discounted_price
        if not result.raw_price:
            result.raw_price = result.raw_discounted
        _clear_discount(result)
        return result

    if result.price is None or result.discounted_price is None:
        return result

    if abs(result.price - result.discounted_price) < 0.01:
        _clear_discount(result)
        return result

    if result.discounted_price > result.price:
        old_price = result.price
        old_raw_price = result.raw_price
        result.price = result.discounted_price
        result.raw_price = result.raw_discounted or result.raw_price
        result.discounted_price = old_price
        result.raw_discounted = old_raw_price

    if result.discounted_price is None or result.price is None:
        return result

    if result.discounted_price >= result.price:
        _clear_discount(result)
        return result

    if result.discounted_price > 0 and result.price > result.discounted_price * 25:
        logger.debug(
            "Dropping suspicious discount pair regular=%s discounted=%s raw=%r raw_discounted=%r",
            result.price,
            result.discounted_price,
            result.raw_price,
            result.raw_discounted,
        )
        _clear_discount(result)

    return result


_RAW_PRICE_CURRENCY_RE = re.compile(
    r"(?:\b(?:rs\.?|lkr|usd|aed|sgd|myr|inr|php|bdt)\b|රු|\/=|\$|€|£|¥|฿|₹|₽)",
    re.IGNORECASE,
)
_RAW_PRICE_HINT_RE = re.compile(
    r"\b(price|list\s*price|our\s*price|selling\s*price|sale\s*price|"
    r"special\s*price|offer\s*price|regular\s*price|unit\s*price|per\s*unit|amount)\b",
    re.IGNORECASE,
)
_RAW_PRICE_SPEC_RE = re.compile(
    r"\b(weight|item\s*code|model|warranty|stock|availability|sku|serial|"
    r"memory\s*type|form\s*factor|capacity|speeds?|latencies?|temperature|"
    r"voltage|dimensions?|length|width|height|depth|size|color|colour|"
    r"days?|years?|weeks?|months?|gm|kg|mg|cm|mm|inch(?:es)?|gb|tb|mb|"
    r"mhz|ghz|mt/s|mah|hz)\b",
    re.IGNORECASE,
)
_RAW_PLAIN_NUMBER_RE = re.compile(r"^\d+(?:[.,]\d{1,2})?$")
_RAW_PRICE_NOISE_RE = re.compile(
    r"\b(koko|installments?|monthly|per\s*month|credit\s*card|interest[\s-]?free|"
    r"today|buy\s*now,\s*pay\s*later|related|recommend|similar|upsell|cross[\s-]?sell|"
    r"hotline|call|contact|whatsapp)\b",
    re.IGNORECASE,
)
_RAW_PHONE_RE = re.compile(r"(?:\+\d{1,3}\s*)?(?:\d[\s-]?){7,}")
_SMART_PRICE_CONTEXT_RE = re.compile(
    r"(price|amount|cost|sale|offer|regular|current|discount|money|"
    r"woocommerce-price|special|compare|now|was)",
    re.IGNORECASE,
)
_SMART_TITLE_CONTEXT_RE = re.compile(
    r"(product[_\s-]*title|entry-title|page-title|post-title|"
    r"product[_\s-]*name|item[_\s-]*name|heading|title)",
    re.IGNORECASE,
)


def _raw_price_signal(raw: Optional[str]) -> int:
    if not raw:
        return -100
    text = raw.strip()
    score = 0
    if _RAW_PRICE_CURRENCY_RE.search(text):
        score += 4
    if _RAW_PRICE_HINT_RE.search(text):
        score += 3
    if re.search(r"\d{1,3}(,\d{3})+(?:\.\d+)?", text):
        score += 2
    if re.search(r"\.\d{2}\b", text):
        score += 1
    if _RAW_PLAIN_NUMBER_RE.fullmatch(text):
        score -= 2
    if _RAW_PRICE_NOISE_RE.search(text):
        score -= 5
    if _RAW_PHONE_RE.search(text) and not _RAW_PRICE_CURRENCY_RE.search(text):
        score -= 6
    if _RAW_PRICE_SPEC_RE.search(text) and not _RAW_PRICE_HINT_RE.search(text):
        score -= 5
    return score


def _smart_candidate_has_price_context(candidate: Optional[dict[str, Any]]) -> bool:
    if not candidate:
        return False
    blob = " ".join(
        str(candidate.get(field) or "")
        for field in ("selector", "dom_path", "tag")
    )
    return bool(_SMART_PRICE_CONTEXT_RE.search(blob))


def _smart_candidate_looks_like_title(candidate: Optional[dict[str, Any]]) -> bool:
    if not candidate:
        return False
    tag = str(candidate.get("tag") or "").lower()
    selector_blob = " ".join(
        str(candidate.get(field) or "")
        for field in ("selector", "dom_path")
    )
    if _SMART_TITLE_CONTEXT_RE.search(selector_blob):
        return True
    node_text = str(candidate.get("node_text") or "")
    return tag in {"h1", "h2", "h3"} and bool(re.search(r"[A-Za-z]", node_text))


def _smart_candidate_is_weak_price(
    candidate: Optional[dict[str, Any]],
    raw: Optional[str],
    value: Optional[float],
) -> bool:
    if not candidate or raw is None or value is None:
        return False

    text = raw.strip()
    if not text:
        return False

    signal = _raw_price_signal(text)
    score = int(candidate.get("score", 0) or 0)
    plain_number = bool(_RAW_PLAIN_NUMBER_RE.fullmatch(text))
    has_price_context = _smart_candidate_has_price_context(candidate)
    title_like = _smart_candidate_looks_like_title(candidate)

    if title_like and signal <= 1 and not has_price_context:
        return True
    if value < 100 and signal <= 1 and not has_price_context and score <= 36:
        return True
    if plain_number and signal <= 1 and not has_price_context and score < 28:
        return True
    return False


def _sanitize_smart_scan_result(
    smart: ScrapeResult,
    smart_data: dict[str, Any],
) -> ScrapeResult:
    sanitized = smart.model_copy(deep=True)
    main = smart_data.get("main") or None
    original = smart_data.get("original") or None

    current_value, current_raw = _current_price_pair(sanitized)
    if _smart_candidate_is_weak_price(main, current_raw, current_value):
        sanitized.price = None
        sanitized.discounted_price = None
        sanitized.raw_price = None
        sanitized.raw_discounted = None
        return _normalize_scrape_result(sanitized)

    if (
        sanitized.discounted_price is not None
        and sanitized.price is not None
        and _smart_candidate_is_weak_price(original, sanitized.raw_price, sanitized.price)
    ):
        sanitized.price = sanitized.discounted_price
        sanitized.raw_price = sanitized.raw_discounted
        _clear_discount(sanitized)

    return _normalize_scrape_result(sanitized)


def _current_price_pair(result: ScrapeResult) -> tuple[Optional[float], Optional[str]]:
    if result.discounted_price is not None:
        return result.discounted_price, result.raw_discounted
    return result.price, result.raw_price


def _regular_price_pair(result: ScrapeResult) -> tuple[Optional[float], Optional[str]]:
    if result.discounted_price is None:
        return None, None
    return result.price, result.raw_price


def _prices_close(left: Optional[float], right: Optional[float]) -> bool:
    if left is None or right is None:
        return False
    tolerance = max(5.0, min(abs(left), abs(right)) * 0.025)
    return abs(left - right) <= tolerance


def _price_ratio(left: Optional[float], right: Optional[float]) -> float:
    if left is None or right is None:
        return float("inf")
    low = min(abs(left), abs(right))
    if low <= 0:
        return float("inf")
    return max(abs(left), abs(right)) / low


def _adopt_smart_prices(target: ScrapeResult, smart: ScrapeResult) -> None:
    target.price = smart.price
    target.discounted_price = smart.discounted_price
    target.raw_price = smart.raw_price
    target.raw_discounted = smart.raw_discounted
    if smart.dealer_price is not None:
        target.dealer_price = smart.dealer_price
        target.raw_dealer = smart.raw_dealer


def _add_review_note(result: ScrapeResult, message: str) -> None:
    if message not in result.review_notes:
        result.review_notes.append(message)


def _review_result_with_smart_scan(
    result: ScrapeResult,
    smart: ScrapeResult,
    smart_data: dict[str, Any],
    *,
    has_custom: bool,
    structured_price_locked: bool,
    user_locks: Optional[set[str]] = None,
) -> ScrapeResult:
    locks = set(user_locks or set())
    # If the user locked any price field via Selector Lab, their pick is
    # authoritative and the smart-scan review must not overwrite it.
    price_locked = bool(locks & {"price", "discounted_price"})
    dealer_locked = "dealer_price" in locks

    if smart.price is None:
        return _normalize_scrape_result(result)

    main = smart_data.get("main") or {}
    main_score = int(main.get("score", 0) or 0)
    if main_score < 24:
        return _normalize_scrape_result(result)

    reviewed = result.model_copy(deep=True)
    original = smart_data.get("original") or {}
    smart_current, smart_current_raw = _current_price_pair(smart)
    result_current, current_raw = _current_price_pair(reviewed)
    smart_regular, smart_regular_raw = _regular_price_pair(smart)
    result_regular, result_regular_raw = _regular_price_pair(reviewed)
    current_signal = _raw_price_signal(current_raw)
    smart_current_signal = _raw_price_signal(smart_current_raw)
    result_regular_signal = _raw_price_signal(result_regular_raw)
    smart_regular_signal = _raw_price_signal(smart_regular_raw)

    current_mismatch = result_current is None or not _prices_close(result_current, smart_current)
    regular_mismatch = False
    if smart_regular is not None:
        regular_mismatch = result_regular is None or not _prices_close(result_regular, smart_regular)
    elif reviewed.discounted_price is not None:
        regular_mismatch = not _prices_close(reviewed.price, smart_current)

    current_ratio = _price_ratio(result_current, smart_current)
    regular_ratio = (
        _price_ratio(result_regular, smart_regular)
        if result_regular is not None and smart_regular is not None
        else 1.0
    )
    major_divergence = current_ratio >= 1.25 or regular_ratio >= 1.25
    extreme_divergence = current_ratio >= 50 or regular_ratio >= 50
    # Smart-scan that had to scan ``document.body`` (no buy-box found, or the
    # buy-box was empty) is unreliable: it can latch onto stray "Rs 4" text
    # in the description, related-product blocks, or footer copy. Don't let
    # that scan silently override a structured-data or user-locked price.
    smart_used_body_fallback = bool(smart_data.get("used_body_fallback"))
    smart_authoritative = not smart_used_body_fallback
    structured_free_sale_pair_enrichment = (
        not price_locked
        and smart_authoritative
        and structured_price_locked
        and result_current is not None
        and result_regular is None
        and smart.discounted_price is not None
        and smart_current == 0
        and smart_regular is not None
        and smart_regular > smart_current
        and (
            _prices_close(result_current, smart_current)
            or _prices_close(result_current, smart_regular)
        )
        and (
            bool(original.get("struck"))
            or bool(original.get("near_sale_signal"))
            or smart_regular_signal >= 2
        )
    )
    if structured_free_sale_pair_enrichment:
        _adopt_smart_prices(reviewed, smart)
        return _normalize_scrape_result(reviewed)

    if (
        structured_price_locked
        and extreme_divergence
        and not price_locked
        and result_current is not None
    ):
        # JSON-LD / microdata reported a price and smart-scan disagrees by
        # 50x+. That ratio is implausible as a real sale — far more likely
        # the smart-scan latched onto a stray number (e.g. "Rs 4" embedded
        # in the product description) and would corrupt the structured value.
        _add_review_note(
            reviewed,
            f"Ignored smart-scan override (Rs {smart_current:.2f}) — "
            f"too far from structured-data price (Rs {result_current:.2f}) "
            "to be a real sale price. Use Selector Lab to map a custom "
            "price selector if the structured price is wrong.",
        )
        # Surface the rejected candidate so the UI can offer a manual switch.
        reviewed.review_alternative_price = smart_current
        reviewed.review_alternative_raw = smart_current_raw or smart.raw_price
        reviewed.review_alternative_label = "smart-scan candidate (rejected)"
        return _normalize_scrape_result(reviewed)

    if price_locked and current_mismatch and result_current is not None:
        # User pinned the selector. Don't touch their price; just surface the
        # smart-scan candidate so the UI can offer a one-click switch.
        #
        # Special case: when both regular and sale prices were extracted
        # (e.g. Woo defaults pulled `del .amount` + `ins .amount`), smart
        # scan on Woody / WoodMart themes often mis-picks the struck
        # regular as its "main" because its strike-through ancestor walk
        # misses the theme's wrapper. That candidate isn't a real
        # disagreement — it's the same regular price we already stored,
        # just relabelled. Surfacing it as an alternative would make the
        # UI ask "Switch to {regular}?" which is nonsense.
        smart_matches_regular = (
            reviewed.discounted_price is not None
            and reviewed.price is not None
            and _prices_close(reviewed.price, smart_current)
        )
        if not smart_matches_regular and reviewed.review_alternative_price is None:
            reviewed.review_alternative_price = smart_current
            reviewed.review_alternative_raw = smart_current_raw or smart.raw_price
            reviewed.review_alternative_label = "smart-scan candidate"
            _add_review_note(
                reviewed,
                f"Smart scan suggests {smart_current:.2f}; kept your Selector "
                f"Lab pick of {result_current:.2f}.",
            )

    # JSON-LD / microdata return prices as plain digits like "275000.00" with
    # no currency prefix and no thousands separators. Treating that low raw
    # signal as "suspicious" lets smart scan override structured prices the
    # moment it finds anything currency-tagged elsewhere in the buy-box, which
    # is exactly the "fix one product, break another" pattern. When the
    # structured source provided the price, plain-digit raw is expected, not
    # weak — so don't penalise it. User-locked prices (Selector Lab) are
    # likewise treated as authoritative; their raw signal should not unlock
    # a smart-scan override.
    raw_signal_authoritative = structured_price_locked or price_locked
    suspicious_current_raw = (
        not raw_signal_authoritative and _raw_price_signal(current_raw) <= 1
    )
    suspicious_regular_raw = (
        reviewed.discounted_price is not None
        and not raw_signal_authoritative
        and _raw_price_signal(reviewed.raw_price) <= 1
    )
    smart_supports_current = (
        result_current is None
        or suspicious_current_raw
        or smart_current_signal >= current_signal + 1
        or (
            smart_regular is not None
            and smart_current_signal >= current_signal
            and smart_regular_signal >= max(2, result_regular_signal)
        )
    )
    smart_supports_regular = (
        result_regular is None
        or suspicious_regular_raw
        or smart_regular_signal >= result_regular_signal + 1
    )
    structured_sale_pair_enrichment = (
        not price_locked
        and smart_authoritative
        and structured_price_locked
        and result_regular is None
        and result_current is not None
        and smart.discounted_price is not None
        and smart_regular is not None
        and smart_current is not None
        and smart_regular > smart_current
        and _prices_close(result_current, smart_current)
        and (
            bool(original.get("struck"))
            or bool(original.get("near_sale_signal"))
            or smart_regular_signal >= 2
        )
    )
    if structured_sale_pair_enrichment:
        _adopt_smart_prices(reviewed, smart)
        return _normalize_scrape_result(reviewed)

    should_adopt = False
    reasons: list[str] = []

    if price_locked:
        # User pinned the price selector in Selector Lab. Treat their value
        # as ground truth — only surface smart-scan as an alternative.
        pass
    elif result_current is None:
        should_adopt = True
        reasons.append("missing current price")
    elif (
        smart_authoritative
        and current_mismatch
        and (
            has_custom
            or not structured_price_locked
            or suspicious_current_raw
            or major_divergence
        )
        and smart_supports_current
    ):
        should_adopt = True
        reasons.append("current price disagrees with smart scan")

    if not price_locked:
        if smart_regular is not None:
            if result_regular is None and (has_custom or not structured_price_locked):
                should_adopt = True
                reasons.append("missing regular price")
            elif (
                smart_authoritative
                and regular_mismatch
                and (
                    has_custom
                    or not structured_price_locked
                    or suspicious_regular_raw
                    or major_divergence
                )
                and smart_supports_regular
            ):
                should_adopt = True
                reasons.append("regular price disagrees with smart scan")
        elif (
            smart_authoritative
            and reviewed.discounted_price is not None
            and (suspicious_current_raw or suspicious_regular_raw)
        ):
            should_adopt = True
            reasons.append("smart scan found no sale pair")

    if should_adopt:
        previous_current = result_current
        previous_current_raw = current_raw
        previous_regular = result_regular
        logger.info(
            "Price review replaced extracted pair with smart scan: reasons=%s extracted=(%s,%s) smart=(%s,%s)",
            ", ".join(dict.fromkeys(reasons)),
            reviewed.price,
            reviewed.discounted_price,
            smart.price,
            smart.discounted_price,
        )
        _adopt_smart_prices(reviewed, smart)
        reviewed.review_status = "corrected"
        # Surface the original extracted price so the UI can offer a manual
        # switch if the user disagrees with the auto-correction.
        if previous_current is not None:
            reviewed.review_alternative_price = previous_current
            reviewed.review_alternative_raw = previous_current_raw
            reviewed.review_alternative_label = "original extracted price"
        _add_review_note(
            reviewed,
            "Review corrected a suspicious price selection using the main product price scan.",
        )
        _add_review_note(
            reviewed,
            "Reason: " + ", ".join(dict.fromkeys(reasons)),
        )
        if previous_current is not None and not _prices_close(previous_current, smart_current):
            _add_review_note(
                reviewed,
                f"Current price changed from {previous_current:.2f} to {smart_current:.2f}.",
            )
        if (
            smart_regular is not None
            and previous_regular is not None
            and not _prices_close(previous_regular, smart_regular)
        ):
            _add_review_note(
                reviewed,
                f"Regular price changed from {previous_regular:.2f} to {smart_regular:.2f}.",
            )

    user_driven = bool(locks)
    # Filling a missing dealer field is fine (we have to source it from
    # somewhere). Replacing an existing one when smart scan is in body-
    # fallback mode is not — the candidate can come from anywhere on the
    # page, including unrelated product blocks.
    can_replace_existing_dealer = smart_authoritative
    if (
        not dealer_locked
        and not user_driven
        and smart.dealer_price is not None
        and (
            reviewed.dealer_price is None
            or (
                can_replace_existing_dealer
                and (_price_ratio(reviewed.dealer_price, smart.dealer_price) >= 1.25)
                and (has_custom or _raw_price_signal(reviewed.raw_dealer) <= 1)
            )
        )
    ):
        reviewed.dealer_price = smart.dealer_price
        reviewed.raw_dealer = smart.raw_dealer
        # Only flag as "corrected" when we actually replaced an existing
        # dealer price — silently filling in a missing field shouldn't pop
        # the amber review banner.
        if reviewed.dealer_price is not None and result.dealer_price is not None:
            reviewed.review_status = "corrected"
            _add_review_note(
                reviewed,
                "Review replaced the dealer price with a stronger smart-scan match.",
            )

    return _normalize_scrape_result(reviewed)


def _should_replace_price(
    current_price: Optional[float],
    current_raw: Optional[str],
    candidate_price: Optional[float],
    candidate_raw: Optional[str],
) -> bool:
    if candidate_price is None:
        return False
    if current_price is None:
        return True
    current_signal = _raw_price_signal(current_raw)
    candidate_signal = _raw_price_signal(candidate_raw)
    if candidate_signal >= current_signal + 3:
        return True
    if candidate_signal <= current_signal:
        return False
    low = min(current_price, candidate_price)
    high = max(current_price, candidate_price)
    if low <= 0:
        return True
    return (high / low) >= 1.5


def _merge_price_candidate(target: ScrapeResult, candidate: ScrapeResult) -> None:
    if _should_replace_price(
        target.price,
        target.raw_price,
        candidate.price,
        candidate.raw_price,
    ):
        target.price = candidate.price
        target.raw_price = candidate.raw_price
        target.discounted_price = candidate.discounted_price
        target.raw_discounted = candidate.raw_discounted
    elif target.discounted_price is None and candidate.discounted_price is not None:
        target.discounted_price = candidate.discounted_price
        target.raw_discounted = candidate.raw_discounted


def _merge_public_and_authenticated_result(
    public: ScrapeResult,
    authenticated: ScrapeResult,
) -> ScrapeResult:
    if public.error and not authenticated.error:
        return _normalize_scrape_result(authenticated)
    if authenticated.error and not public.error:
        return _normalize_scrape_result(public)
    if public.price is None and public.discounted_price is None:
        return _normalize_scrape_result(authenticated)

    merged = public.model_copy(deep=True)

    if not merged.title and authenticated.title:
        merged.title = authenticated.title
    if _should_replace_stock_status(
        merged.stock_status,
        authenticated.stock_status,
    ):
        merged.stock_status = authenticated.stock_status

    dealer_price = authenticated.dealer_price
    dealer_raw = authenticated.raw_dealer

    if dealer_price is None:
        public_current, _ = _current_price_pair(public)
        public_regular, _ = _regular_price_pair(public)
        auth_current, auth_current_raw = _current_price_pair(authenticated)
        auth_is_distinct = (
            auth_current is not None
            and public_current is not None
            and not _prices_close(auth_current, public_current)
            and (public_regular is None or not _prices_close(auth_current, public_regular))
        )
        if auth_is_distinct and auth_current < public_current:
            dealer_price = auth_current
            dealer_raw = auth_current_raw

    if dealer_price is not None:
        merged.dealer_price = dealer_price
        merged.raw_dealer = dealer_raw
        if authenticated.review_status == "corrected":
            merged.review_status = "corrected"
        for note in authenticated.review_notes:
            _add_review_note(merged, note)
        _add_review_note(
            merged,
            "Authenticated login session preserved the public price and stored the dealer price separately.",
        )

    return _normalize_scrape_result(merged)


def _clear_dealer_price(result: ScrapeResult) -> ScrapeResult:
    result.dealer_price = None
    result.raw_dealer = None
    return result


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
                parsed_price = _parse_price(raw_price)
                parsed_low = _parse_price(raw_low)
                price = parsed_price if parsed_price is not None else parsed_low
                raw = raw_price or raw_low or None

                avail = offers.get("availability", "") if offers else ""
                stock = _stock_from_schema_url(avail) if avail else "unknown"

                if name or price is not None:
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
                if p is not None:
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

    if result.price is not None:
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
    # Scoped to the main product block first so we don't pick up variant-option,
    # "you may also like", cart-sidebar, or payment-method variant prices.
    # Newer CS-Cart templates (nanotek 2026+) put the price as raw text directly
    # inside `.ty-price-now`, with no `.ty-price-num` child — selectors here
    # cover both layouts.
    ".ty-productPage-price .ty-price-now .ty-price-num",
    ".ty-productPage-price .ty-price-now",
    ".ty-product-block .ty-price-now .ty-price-num",
    ".ty-product-block .ty-price .ty-price-num",
    ".ty-product-block .ty-price-now",
    ".ty-price-now .ty-price-num",
    ".ty-price-now",
    ".ty-price .ty-price-num",
    "[id^='line_discounted_price_'] .ty-price-num",
    "[id^='line_discounted_price_']",
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
    product_root = await _get_product_root(page)
    price_scope_only = product_root is not None
    try:
        for sel in _PRICE_SELECTORS:
            el = await _query_selector_scoped(
                page,
                sel,
                root=product_root,
                allow_page_fallback=not price_scope_only,
            )
            if el:
                raw = await _read_element_text(el)
                if _is_installment_price(raw):
                    continue
                p = _parse_price(raw)
                if p is not None:
                    result.price = p
                    result.raw_price = raw.strip()
                    break

        for sel in _ORIG_PRICE_SELECTORS:
            el = await _query_selector_scoped(
                page,
                sel,
                root=product_root,
                allow_page_fallback=not price_scope_only,
            )
            if el:
                raw = await _read_element_text(el)
                if _is_installment_price(raw):
                    continue
                p = _parse_price(raw)
                if p is not None and result.price is not None and p > result.price:
                    # Current sale price stays in .price; original moves to .discounted_price swap.
                    # Convention here: price = original/retail, discounted_price = sale/current.
                    result.discounted_price = result.price
                    result.raw_discounted = result.raw_price
                    result.price = p
                    result.raw_price = raw.strip()
                    break

        for sel in _DEALER_PRICE_SELECTORS:
            el = await _query_selector_scoped(
                page,
                sel,
                root=product_root,
                allow_page_fallback=not price_scope_only,
            )
            if el:
                raw = await _read_element_text(el)
                if not _is_installment_price(raw):
                    d = _parse_price(raw)
                    if d is not None:
                        result.dealer_price = d
                        result.raw_dealer = raw.strip()
                        break

        for sel in _TITLE_SELECTORS:
            el = await _query_selector_scoped(page, sel, root=product_root)
            if el:
                t = await _read_element_text(el)
                if t:
                    result.title = t
                    break

        for sel in _STOCK_SELECTORS:
            els = await _query_selector_all_scoped(page, sel, root=product_root)
            found = False
            for el in els:
                t = await _read_element_text(el)
                s = _parse_stock(t)
                if s != "unknown":
                    result.stock_status = s
                    found = True
                    break
            if found:
                break

    except Exception as e:
        logger.debug("Common pattern extraction error: %s", e)

    if result.price is not None:
        logger.info(
            "Common pattern hit: name=%s price=%s dealer=%s",
            result.title, result.price, result.dealer_price,
        )
    return _normalize_scrape_result(result)


# ── Strategy: Facebook Marketplace (inline JSON) ─────────────────────────────
#
# FB Marketplace embeds product data inside <script> tags as nested GraphQL
# JSON. CSS-selector and JSON-LD extraction don't work because there are no
# stable selectors and FB doesn't emit Schema.org markup. We pull the relevant
# keys with regex from the script blob — order-independent, robust to the
# layout shuffles FB does on every release.
#
# Keys we look for:
#   - marketplace_listing_title          → title
#   - listing_price.amount               → current price (sale price if sale)
#   - strikethrough_price.amount         → original price (presence => discount)
#   - listing_price.formatted_amount     → raw price string with currency
#   - is_live / is_pending / is_sold     → stock status

_FB_MARKETPLACE_HOSTS = {"facebook.com", "m.facebook.com"}


def _is_facebook_marketplace_url(url: Optional[str]) -> bool:
    if not url:
        return False
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if host.startswith(("www.", "web.")):
            host = host[4:]
        if host not in _FB_MARKETPLACE_HOSTS:
            return False
        return "/marketplace/" in (parsed.path or "")
    except Exception:
        return False


def _facebook_marketplace_item_id(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        from urllib.parse import urlparse
        path = urlparse(url).path or ""
    except Exception:
        return None
    match = re.search(r"/marketplace/item/(\d+)", path)
    if not match:
        match = re.search(r"/marketplace/[^/]+/item/(\d+)", path)
    return match.group(1) if match else None


_FB_TITLE_RE = re.compile(r'"marketplace_listing_title"\s*:\s*"((?:[^"\\]|\\.)*)"')
_FB_AMOUNT_RE = re.compile(r'"amount"\s*:\s*"([^"]+)"')
_FB_FORMATTED_AMOUNT_RE = re.compile(
    r'"(?:formatted_amount|formatted_amount_zeros_stripped|formattedAmountWithoutDecimals)"'
    r'\s*:\s*"((?:[^"\\]|\\.)*)"'
)
_FB_FORMATTED_PRICE_TEXT_RE = re.compile(
    r'"formatted_price"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"'
)
_FB_IS_LIVE_RE = re.compile(r'"is_live"\s*:\s*(true|false)')
_FB_IS_PENDING_RE = re.compile(r'"is_pending"\s*:\s*(true|false)')
_FB_IS_SOLD_RE = re.compile(r'"is_sold"\s*:\s*(true|false)')


def _decode_fb_json_string(value: str) -> str:
    if not value:
        return value
    try:
        return json.loads(f'"{value}"')
    except Exception:
        return value


def _extract_fb_object_ranges(blob: str, key: str) -> list[tuple[int, int, str]]:
    """Extract every JSON object value for ``"key": { ... }`` from a blob."""
    ranges: list[tuple[int, int, str]] = []
    needle = f'"{key}"'
    search_from = 0
    while True:
        idx = blob.find(needle, search_from)
        if idx == -1:
            return ranges
        pos = idx + len(needle)
        while pos < len(blob) and blob[pos] in " \t\r\n":
            pos += 1
        if pos < len(blob) and blob[pos] == ':':
            pos += 1
        else:
            search_from = idx + len(needle)
            continue
        while pos < len(blob) and blob[pos] in " \t\r\n":
            pos += 1
        if pos >= len(blob) or blob[pos] != '{':
            search_from = idx + len(needle)
            continue
        depth = 0
        in_str = False
        escape = False
        start = pos
        while pos < len(blob):
            c = blob[pos]
            if in_str:
                if escape:
                    escape = False
                elif c == '\\':
                    escape = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        end = pos + 1
                        ranges.append((start, end, blob[start:end]))
                        search_from = end
                        break
            pos += 1
        else:
            return ranges


def _extract_fb_object(blob: str, key: str) -> Optional[str]:
    ranges = _extract_fb_object_ranges(blob, key)
    return ranges[0][2] if ranges else None


def _fb_positions(blob: str, needle: Optional[str]) -> list[int]:
    if not blob or not needle:
        return []
    return [m.start() for m in re.finditer(re.escape(needle), blob)]


def _fb_nearest_distance(pos: int, anchors: list[int]) -> Optional[int]:
    if not anchors:
        return None
    return min(abs(pos - anchor) for anchor in anchors)


def _fb_scope_for_object(
    blob: str,
    start: int,
    end: int,
    anchors: list[int],
) -> str:
    if anchors:
        anchor = min(anchors, key=lambda pos: abs(start - pos))
    else:
        anchor = start
    scope_start = max(0, min(anchor, start) - 6000)
    scope_end = min(len(blob), max(anchor, end) + 30000)
    return blob[scope_start:scope_end]


def _fb_select_listing_scope(
    blobs: list[str],
    item_id: Optional[str],
) -> tuple[str, str] | tuple[None, None]:
    """Choose the listing_price object scoped to the Marketplace item id.

    Facebook hydration often contains the target listing plus recommendation
    lists. This keeps the extractor anchored to the item URL instead of the
    first price in the page's script order.
    """
    best: Optional[tuple[tuple[int, ...], str, str]] = None
    for script_index, blob in enumerate(blobs):
        if not blob:
            continue
        item_anchors = _fb_positions(blob, item_id)
        title_anchors = [m.start() for m in _FB_TITLE_RE.finditer(blob)]
        anchors = item_anchors or title_anchors
        for start, end, obj in _extract_fb_object_ranges(blob, "listing_price"):
            amount, formatted = _extract_fb_amount(obj)
            if _parse_price(amount or formatted) is None:
                continue
            distance = _fb_nearest_distance(start, anchors)
            distance_value = distance if distance is not None else 1_000_000
            distance_score = 1_000_000 - min(distance_value, 1_000_000)
            has_target_id = 1 if item_anchors else 0
            has_title = 1 if title_anchors else 0
            has_formatted = 1 if formatted else 0
            score = (
                has_target_id,
                distance_score,
                has_title,
                has_formatted,
                -script_index,
                -start,
            )
            scope = _fb_scope_for_object(blob, start, end, anchors)
            if best is None or score > best[0]:
                best = (score, scope, obj)
    if best is None:
        return None, None
    return best[1], best[2]


def _extract_fb_amount(obj_str: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Pull ``amount`` and decoded ``formatted_amount`` from a price object."""
    if not obj_str:
        return None, None
    amount = None
    formatted = None
    m = _FB_AMOUNT_RE.search(obj_str)
    if m:
        amount = m.group(1)
    m = _FB_FORMATTED_AMOUNT_RE.search(obj_str)
    if m:
        formatted = _decode_fb_json_string(m.group(1))
    return amount, formatted


def _extract_fb_formatted_price(blob: str) -> Optional[str]:
    m = _FB_FORMATTED_PRICE_TEXT_RE.search(blob)
    if not m:
        return None
    return _decode_fb_json_string(m.group(1))


async def _find_fb_dom_strikethrough(page: Page) -> Optional[str]:
    """Read the visible strikethrough price straight from the DOM.

    Used when JSON extraction misses ``strikethrough_price`` (FB renames
    GraphQL fields periodically). Looks for any short element whose
    computed ``text-decoration-line`` includes ``line-through`` and
    contains a digit.
    """
    try:
        return await page.evaluate(
            """() => {
                const candidates = Array.from(
                    document.querySelectorAll('span, div, s, del')
                );
                for (const el of candidates) {
                    const txt = (el.textContent || '').trim();
                    if (!txt || txt.length > 60) continue;
                    if (!/[0-9]/.test(txt)) continue;
                    const cs = window.getComputedStyle(el);
                    const tdl = cs.textDecorationLine || cs.textDecoration || '';
                    if (tdl.indexOf('line-through') !== -1) {
                        return txt;
                    }
                }
                return null;
            }"""
        )
    except Exception as e:
        logger.debug("FB Marketplace DOM strikethrough search failed: %s", e)
        return None


async def _try_facebook_marketplace(page: Page) -> ScrapeResult:
    """Pull title / price / discount / stock from FB Marketplace inline JSON.

    Only runs when the URL is a Marketplace listing. Returns an empty
    ScrapeResult on any failure so the regular waterfall continues.
    """
    result = ScrapeResult()
    if not _is_facebook_marketplace_url(getattr(page, "url", "")):
        return result
    try:
        scripts = await page.evaluate(
            """() => {
                const scripts = Array.from(document.querySelectorAll('script'));
                const parts = [];
                for (const s of scripts) {
                    const text = s.textContent || '';
                    if (
                        text.indexOf('marketplace_listing_title') !== -1 ||
                        text.indexOf('listing_price') !== -1 ||
                        text.indexOf('strikethrough_price') !== -1
                    ) {
                        parts.push(text);
                    }
                }
                return parts;
            }"""
        )
    except Exception as e:
        logger.debug("FB Marketplace blob fetch failed: %s", e)
        return result

    blobs = [text for text in scripts if isinstance(text, str) and text] if scripts else []
    if not blobs:
        return result

    item_id = _facebook_marketplace_item_id(getattr(page, "url", ""))
    blob, listing_obj = _fb_select_listing_scope(blobs, item_id)
    if not blob:
        blob = "\n".join(blobs)
        listing_obj = _extract_fb_object(blob, "listing_price")

    title_match = _FB_TITLE_RE.search(blob)
    if title_match:
        result.title = _decode_fb_json_string(title_match.group(1))

    strike_obj = _extract_fb_object(blob, "strikethrough_price")
    listing_amount_str, listing_formatted_str = _extract_fb_amount(listing_obj)
    strike_amount_str, strike_formatted_str = _extract_fb_amount(strike_obj)

    listing_value = _parse_price(listing_amount_str or listing_formatted_str)
    listing_raw = listing_formatted_str or _extract_fb_formatted_price(blob) or listing_amount_str
    strike_value = _parse_price(strike_amount_str or strike_formatted_str)
    strike_raw = strike_formatted_str or strike_amount_str

    # DOM fallback: when JSON misses the strike (FB renames fields), read
    # the line-through element directly from the rendered page.
    if listing_value is not None and strike_value is None:
        dom_strike = await _find_fb_dom_strikethrough(page)
        if dom_strike:
            parsed = _parse_price(dom_strike)
            if parsed is not None and parsed > listing_value:
                strike_value = parsed
                strike_raw = dom_strike

    if listing_value is not None and strike_value is not None and strike_value > listing_value:
        # Strikethrough is the original; listing_price is the sale price.
        result.price = strike_value
        result.raw_price = strike_raw or str(strike_value)
        result.discounted_price = listing_value
        result.raw_discounted = listing_raw or str(listing_value)
    elif listing_value is not None:
        result.price = listing_value
        result.raw_price = listing_raw or str(listing_value)

    # Stock: FB exposes is_live (current public status) and the legacy
    # is_pending / is_sold flags. Treat any "sold" marker as out-of-stock.
    is_sold = _FB_IS_SOLD_RE.search(blob)
    if is_sold and is_sold.group(1) == "true":
        result.stock_status = "out_of_stock"
    else:
        is_live = _FB_IS_LIVE_RE.search(blob)
        if is_live:
            result.stock_status = "in_stock" if is_live.group(1) == "true" else "out_of_stock"
        else:
            is_pending = _FB_IS_PENDING_RE.search(blob)
            if is_pending and is_pending.group(1) == "false":
                result.stock_status = "in_stock"

    if result.price or result.title:
        logger.info(
            "FB Marketplace hit: name=%s price=%s disc=%s stock=%s",
            result.title, result.price, result.discounted_price, result.stock_status,
        )
    return _normalize_scrape_result(result)


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

def _facebook_probe_candidates_from_result(result: ScrapeResult) -> list[ProbeCandidate]:
    candidates: list[ProbeCandidate] = []
    if result.discounted_price is not None:
        if result.raw_discounted:
            candidates.append(ProbeCandidate(
                text=result.raw_discounted[:80],
                value=result.discounted_price,
                score=120,
                dom_path="facebook-marketplace listing_price",
            ))
        if result.raw_price:
            candidates.append(ProbeCandidate(
                text=result.raw_price[:80],
                value=result.price,
                score=110,
                struck=True,
                dom_path="facebook-marketplace strikethrough_price",
            ))
    elif result.price is not None and result.raw_price:
        candidates.append(ProbeCandidate(
            text=result.raw_price[:80],
            value=result.price,
            score=120,
            dom_path="facebook-marketplace listing_price",
        ))
    return candidates


def _facebook_selector_candidates_from_result(
    result: ScrapeResult,
) -> list[SelectorLabCandidate]:
    candidates: list[SelectorLabCandidate] = []
    fields = [
        (
            "listing_price",
            result.raw_discounted if result.discounted_price is not None else result.raw_price,
            result.discounted_price if result.discounted_price is not None else result.price,
            "Facebook Marketplace current price from inline JSON",
        ),
        (
            "strikethrough_price",
            result.raw_price if result.discounted_price is not None else None,
            result.price if result.discounted_price is not None else None,
            "Facebook Marketplace struck regular price from inline JSON",
        ),
    ]
    for key, raw, value, reason in fields:
        if value is None or not raw:
            continue
        candidates.append(SelectorLabCandidate(
            selector=f"facebook-marketplace:{key}",
            dom_path=key,
            text=raw[:160],
            sample=raw[:80],
            value=value,
            source="facebook-marketplace",
            confidence=95,
            kind_hints=[],
            reason=reason,
        ))
    return candidates


_SMART_SCAN_JS = r"""() => {
    function visible(el) {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden'
            && parseFloat(s.opacity || '1') > 0;
    }

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    const PRODUCT_ROOT_SELECTORS = [
        'div.summary.entry-summary',
        '.summary.entry-summary',
        '#product .summary',
        '.product-details-area',
        '.product-view-area',
        '.ty-product-block',
        '.ty-productPage-body',
        '.ty-productPage',
        '#product-info-main',
        '.product__info-container',
        '.product-single__info',
        '.product-page',
        'article.product',
        '[itemtype*="Product"]',
    ];

    const BAD = /cart|basket|total|checkout|order-summary|order-total|mini-cart|ship(?:ping)?|emi|monthly|instalment|installment|per[\s-]?month|easy[\s-]?pay|flexi|interest[\s-]?free|per[\s-]?week|payment[\s-]?plan|visa|mastercard|credit[\s-]?card|debit[\s-]?card|card[\s-]?offer|related|similar|recommend|cross[\s-]?sell|upsell|recently[\s-]?viewed|featured|bundle|combo|accessories|meta|posted_in|nav|menu|header|footer|inst-zone|inst-line|rx-inst|payhere|koko|mintpay|klarna|afterpay|affirm|zippay|downsale|sale-badge|discount-badge|sticker|badge/i;
    const BAD_TEXT = /\b(related\s+products?|you\s+might\s+also\s+be\s+interested|similar\s+products?|recommended\s+products?|customers\s+also\s+bought|frequently\s+bought\s+together|recently\s+viewed|featured\s+products?|bundle\s+deal|combo\s+deal)\b/i;
    const STRIKE = /\b(retail|was|compare|original|old|regular|strike|crossed|del-price|list-price|ty-list-price|ty-price-retail|mrp|rrp|old-price|price-old|was-price|price-was|sale-was|line-through|strikethrough|previous-price|msrp|rrp-price|price-old-amount)\b/i;
    const DEALER = /dealer|wholesale|trade|b2b|your[\s-]?price|distributor|reseller/i;
    const PRICE_CONTEXT = /\bprice\b|\bcost\b|\bamount\b/i;
    const PROD_CONTEXT = /product|summary|detail|info|offer|sale|now|current|item-main|ty-product-block|prod-main/i;
    const SALE_SIGNAL = /\b(save|was|regular|originally|compare|rrp|mrp|msrp|list[\s-]?price|retail[\s-]?price|you[\s-]?save|off)\b|\d+\s*%\s*off|−\s*\d|-\s*\d+\s*%/i;
    const FREE_PRICE_SIGNAL = /\b(?:gratis|complimentary|no\s+charge|free(?!\s+(?:trial|demo|version|shipping|delivery|download|software|utility|tool|support|updates?|upgrades?)))\b/i;
    const FREE_PRICE_EXCLUSION = /\btrial\b/i;
    const CURRENCY_SIGNAL = /(?:\b(?:rs\.?|lkr|usd|aed|sgd|myr|inr|php|bdt)\b|රු|\/=|\$|€|£|¥|฿|₹|₽)/i;
    const INLINE_PRICE_SIGNAL = /\b(?:price|list[\s-]?price|our[\s-]?price|selling[\s-]?price|special[\s-]?price|sale[\s-]?price|offer[\s-]?price|regular[\s-]?price|unit[\s-]?price|per[\s-]?unit|amount)\b/i;
    const INLINE_SPEC_SIGNAL = /\b(?:weight|item[\s-]?code|model|warranty|stock|availability|sku|serial|memory[\s-]?type|form[\s-]?factor|capacity|speeds?|latencies?|temperature|voltage|dimensions?|length|width|height|depth|size|color|colour|days?|years?|weeks?|months?|specification|specifications)\b/i;
    const MEASURE_UNIT = /\b(?:gm|kg|mg|cm|mm|inch(?:es)?|gb|tb|mb|mhz|ghz|mt\/s|mah|hz|w|v|°c)\b/i;
    const PHONE_LIKE = /(?:\+\d{1,3}\s*)?(?:\d[\s-]?){7,}/;
    const PRICE_FRAGMENT_RE = /(?:rs\.?|lkr|රු|\/=|\$|€|£|¥|฿|₹|₽)?\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:\/=|rs\.?|lkr))?/ig;
    // A variant-option container holds several alternative prices (one per
    // color/size/config) that are NOT the main displayed price. Candidates
    // inside these containers get deprioritized unless they also sit inside
    // a "selected/active/checked" marker.
    const VARIANT_ALT = /variant-option|swatch-option|variant-item|option-value|product-options|ty-product-options|ty-product-variant-image-item(?!-checked)|configurable_option|product-form__input|variant-selector|product-variants|attributes-selector|ty-pay-price|payment-method|ty-payment-method|ty-payment-options/i;
    const SELECTED = /selected|is-active|is-selected|is-checked|active|checked|current[\s-]?variant|ty-product-variant-image-item-checked|aria-selected/i;
    const ADD_TO_CART_SELECTOR = [
        'button[type="submit"]',
        '.add-to-cart',
        '.single_add_to_cart_button',
        '.buy-now',
        '#add-to-cart-button',
        '[data-action*="cart"]',
        '[class*="add-to-cart"]',
        '[class*="addtocart"]',
        '[class*="AddToCart"]',
        '[class*="buy-now"]',
        '[class*="buynow"]',
        'button[name*="cart"]',
        'button[name*="add-to-cart"]',
        'form.cart button',
        'form[action*="cart"] button',
        'a[href*="add-to-cart"]',
        '[data-qa*="cart" i]',
        '[data-qa*="buy" i]',
        '[data-qa*="purchase" i]',
        '[data-qa*="add-to-library" i]',
        '[data-qa*="add-to-bag" i]',
        '[data-testid*="cart" i]',
        '[data-testid*="buy" i]',
        '[data-testid*="purchase" i]',
        '[data-testid*="add-to-library" i]',
        '[aria-label*="add to cart" i]',
        '[aria-label*="buy now" i]',
        '[aria-label*="add to library" i]',
        '[aria-label*="add to bag" i]',
        '[aria-label*="purchase" i]',
    ].join(', ');
    const PURCHASE_TEXT = /\b(add[\s-]?to[\s-]?cart|buy[\s-]?now|purchase|checkout|pre[\s-]?(?:purchase|order)|order[\s-]?now)\b/i;

    function hasPriceText(value) {
        const text = normalizeText(value);
        return /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?/.test(text)
            || /(?:rs\.?|lkr|\$|€|£|¥|₹|฿)\s*\d+(?:\.\d{1,2})?/i.test(text)
            || /\b(?:free|included(?:\s+with)?|coming\s+soon|pre[\s-]?order|game\s+trial|trial\s+available)\b/i.test(text);
    }

    function isEpicStoreHost() {
        return /(?:^|\.)epicgames\.com$/i.test(window.location.hostname || '');
    }

    function focusedPurchaseRoot() {
        const candidates = [];
        for (const control of document.querySelectorAll(ADD_TO_CART_SELECTOR)) {
            if (!visible(control)) continue;
            const controlText = normalizeText(
                (control.innerText || control.textContent || '') + ' ' +
                (control.getAttribute('aria-label') || '') + ' ' +
                (control.getAttribute('data-testid') || '') + ' ' +
                (control.getAttribute('data-qa') || '')
            );
            if (!PURCHASE_TEXT.test(controlText)) continue;
            const priority = /\b(buy[\s-]?now|purchase|checkout|pre[\s-]?(?:purchase|order)|order[\s-]?now)\b/i.test(controlText)
                ? 0
                : 1;
            let cur = control.parentElement;
            for (let depth = 0; depth < 8 && cur; depth += 1, cur = cur.parentElement) {
                if (!cur.querySelectorAll) continue;
                const innerText = normalizeText(cur.innerText || cur.textContent || '');
                if (!innerText || innerText.length < 20 || innerText.length > 8000) continue;
                if (!hasPriceText(innerText)) continue;
                candidates.push({ el: cur, priority, depth, len: innerText.length });
            }
        }
        candidates.sort((a, b) => a.priority - b.priority || a.len - b.len || a.depth - b.depth);
        return candidates[0]?.el || null;
    }

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
            const text = normalizeText((cur.innerText || cur.textContent || '').slice(0, 1200));
            if (text && BAD_TEXT.test(text)) return true;
        }
        return false;
    }

    // Variant-alt detection: walk up to 6 ancestors. If any ancestor is a
    // known variant-option container AND no ancestor within that scope is
    // marked as "selected/active/checked", treat the candidate as an
    // alternate variant price (deprioritize it).
    function variantAlt(el) {
        let cur = el;
        let inVariant = false;
        let selected = false;
        for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            const info = ((cur.className || '') + ' ' + (cur.id || '')).toString();
            if (!inVariant && VARIANT_ALT.test(info)) inVariant = true;
            if (SELECTED.test(info)) selected = true;
            try {
                if (cur.getAttribute &&
                    (cur.getAttribute('aria-selected') === 'true' ||
                     cur.getAttribute('data-selected') === 'true' ||
                     cur.getAttribute('aria-checked') === 'true')) {
                    selected = true;
                }
            } catch (_) {}
        }
        return inVariant && !selected;
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

    function looksTitleLike(el, text) {
        if (!el) return false;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        let cur = el;
        for (let i = 0; i < 3 && cur; i++, cur = cur.parentElement) {
            const info = ((cur.className || '') + ' ' + (cur.id || '')).toString();
            if (/(product[_\s-]?title|entry-title|page-title|post-title|product[_\s-]?name|item[_\s-]?name|heading)/i.test(info)) {
                return true;
            }
        }
        return /^h[1-3]$/.test(tag) && /[A-Za-z]/.test(text || '');
    }

    function structurePart(el) {
        if (!el || !el.tagName) return '';
        let part = el.tagName.toLowerCase();
        const classes = typeof el.className === 'string'
            ? el.className.split(/\s+/).filter(Boolean).slice(0, 2)
            : [];
        if (classes.length > 0) {
            part += '.' + classes.map(escapeCss).join('.');
        }
        if (el.parentElement) {
            const siblings = Array.from(el.parentElement.children)
                .filter((sibling) => sibling.tagName === el.tagName);
            if (siblings.length > 1) {
                const index = siblings.indexOf(el);
                if (index >= 0) {
                    part += `:nth-of-type(${index + 1})`;
                }
            }
        }
        return part;
    }

    function lineageKeys(el) {
        const keys = [];
        let cur = el ? el.parentElement : null;
        for (let i = 0; i < 5 && cur; i++, cur = cur.parentElement) {
            const key = structurePart(cur);
            if (key) keys.push(key);
        }
        return keys;
    }

    function sharedLineageScore(left, right) {
        if (!Array.isArray(left) || !Array.isArray(right)) return 0;
        let best = 0;
        for (let i = 0; i < left.length; i++) {
            for (let j = 0; j < right.length; j++) {
                if (left[i] && left[i] === right[j]) {
                    const score = Math.max(0, 10 - ((i + j) * 2));
                    if (score > best) best = score;
                }
            }
        }
        return best;
    }

    function relativeGap(mainValue, candidateValue) {
        if (!(mainValue > 0) || !(candidateValue > 0)) return Number.POSITIVE_INFINITY;
        return Math.abs(candidateValue - mainValue) / mainValue;
    }

    function originalPairScore(main, candidate) {
        if (!main || !candidate) return Number.NEGATIVE_INFINITY;
        if (candidate.dealer || candidate.variant_alt || !(candidate.value > main.value)) {
            return Number.NEGATIVE_INFINITY;
        }
        const lineage = sharedLineageScore(main.lineage, candidate.lineage);
        let score = lineage * 12;
        if (candidate.struck) score += 18;
        if (candidate.near_sale_signal) score += 10;
        score += Math.min(candidate.score || 0, main.score || 0) / 3;
        const gap = relativeGap(main.value, candidate.value);
        if (gap <= 0.05) score += 14;
        else if (gap <= 0.15) score += 10;
        else if (gap <= 0.35) score += 6;
        else if (gap <= 0.75) score += 2;
        else score -= Math.min(18, Math.floor(gap * 8));
        return score;
    }

    function publicCandidate(candidate) {
        if (!candidate) return null;
        return {
            text: candidate.text,
            node_text: candidate.node_text,
            value: candidate.value,
            score: candidate.score,
            font_size: candidate.font_size,
            font_weight: candidate.font_weight,
            struck: candidate.struck,
            dealer: candidate.dealer,
            variant_alt: candidate.variant_alt,
            near_sale_signal: candidate.near_sale_signal,
            dom_path: candidate.dom_path,
            selector: candidate.selector,
            tag: candidate.tag,
        };
    }

    function stockStatusFromText(text, opts = {}) {
        const disabled = !!opts.disabled;
        const rawLines = String(text || '')
            .split(/\n+/)
            .map((line) => normalizeText(line).toLowerCase())
            .filter(Boolean);
        const firstLine = rawLines[0] || '';
        const value = normalizeText(text).toLowerCase();
        if (!value) return null;
        if (/\b(?:availability|stock)\s*:?\s*(?:no|false|0)\b/.test(value)) {
            return 'out_of_stock';
        }
        if (/\b(?:availability|stock)\s*:?\s*(?:yes|true|1)\b/.test(value)) {
            return 'in_stock';
        }
        if (firstLine && firstLine.length <= 80) {
            if (/call\s+for\s+price|price\s+on\s+request|ask\s+for\s+price/.test(firstLine)) {
                return 'call_for_price';
            }
            if (/discontinued|end\s+of\s+life|eol/.test(firstLine)) {
                return 'discontinued';
            }
            if (/out.?of.?stock|sold.?out|unavailable|not available/.test(firstLine)) {
                return 'out_of_stock';
            }
            if (/pre[\s-]?order|pre[\s-]?sale|coming[\s-]?soon|notify[\s-]?me|notify[\s-]?when/.test(firstLine)) {
                return 'preorder';
            }
            if (/back[\s-]?order|on[\s-]?backorder/.test(firstLine)) {
                return 'backorder';
            }
            if (/limited[\s-]?stock|low[\s-]?stock|few[\s-]?left/.test(firstLine)) {
                return 'limited';
            }
            if (/in[\s-]?stock|available\s+now|ready\s+to\s+ship|add|buy|cart|order|purchase|checkout|shop.?now/.test(firstLine)) {
                return 'in_stock';
            }
        }
        if (/call\s+for\s+price|price\s+on\s+request|ask\s+for\s+price/.test(value)) {
            return 'call_for_price';
        }
        if (/pre[\s-]?order|pre[\s-]?sale|coming[\s-]?soon|notify[\s-]?me|notify[\s-]?when/.test(value)) {
            return 'preorder';
        }
        if (/back[\s-]?order|on[\s-]?backorder/.test(value)) {
            return 'backorder';
        }
        if (/out.?of.?stock|sold.?out|unavailable|not available/.test(value)) {
            return 'out_of_stock';
        }
        if (disabled && /add|buy|cart|order|purchase|checkout|shop.?now/.test(value)) {
            return 'out_of_stock';
        }
        if (/limited[\s-]?stock|low[\s-]?stock|few[\s-]?left/.test(value)) {
            return 'limited';
        }
        if (/add|buy|cart|order|purchase|checkout|shop.?now|in[\s-]?stock|\bavailable\b/.test(value)) {
            return 'in_stock';
        }
        return null;
    }

    function stockStatusScoreBonus(status) {
        if (status === 'out_of_stock' || status === 'discontinued') return 30;
        if (status === 'call_for_price' || status === 'contact_store') return 12;
        if (status === 'preorder' || status === 'backorder') return 10;
        if (status === 'limited') return 4;
        return 0;
    }

    function collectStockSignal(scope) {
        if (!scope || !scope.querySelectorAll) return null;
        const signals = [];
        let order = 0;
        const controlSelectors = [
            'button',
            'input[type="submit"]',
            '[role="button"]',
            '.add-to-cart',
            '.buy-now',
            '#add-to-cart-button',
            '[data-action*="cart"]',
            '[class*="add-to-cart"]',
            '[class*="buy-now"]',
            'a[href*="cart"]',
        ];
        for (const sel of controlSelectors) {
            for (const el of scope.querySelectorAll(sel)) {
                if (!visible(el) || inBadContext(el)) continue;
                const text = normalizeText((el.innerText || el.textContent || el.value || '') + '');
                if (!text) continue;
                const disabled = !!el.disabled || el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true';
                const status = stockStatusFromText(text, { disabled });
                if (!status) continue;
                let score = 34;
                if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') score += 18;
                if (/add[\s-]?to[\s-]?cart|buy[\s-]?now|order[\s-]?now|purchase|checkout|shop.?now/.test(text.toLowerCase())) score += 20;
                if (/out.?of.?stock|sold.?out|pre[\s-]?order|back[\s-]?order/.test(text.toLowerCase())) score += 20;
                if (disabled) score += 6;
                score += stockStatusScoreBonus(status);
                signals.push({ status, score, order: order++ });
            }
        }

        const hintSelectors = [
            '[class*="stock"]',
            '[class*="avail"]',
            '[id*="stock"]',
            '[id*="avail"]',
            '[data-stock]',
            '[data-availability]',
        ];
        for (const sel of hintSelectors) {
            for (const el of scope.querySelectorAll(sel)) {
                if (!visible(el) || inBadContext(el)) continue;
                const text = normalizeText((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('data-stock') || '') + ' ' + (el.getAttribute('data-availability') || ''));
                if (!text) continue;
                const status = stockStatusFromText(text);
                if (!status) continue;
                let score = 28;
                if (/stock|availability/.test(text.toLowerCase())) score += 18;
                score += stockStatusScoreBonus(status);
                signals.push({ status, score, order: order++ });
            }
        }

        signals.sort((a, b) => b.score - a.score || a.order - b.order);
        return signals[0] || null;
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

    function escapeCss(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    function elementSelector(el) {
        if (!el || !el.tagName) return '';
        if (el.id) return '#' + escapeCss(el.id);

        const parts = [];
        let cur = el;
        for (let i = 0; i < 4 && cur && cur.tagName; i++, cur = cur.parentElement) {
            let part = cur.tagName.toLowerCase();
            const classes = typeof cur.className === 'string'
                ? cur.className.split(/\s+/).filter(Boolean).slice(0, 2)
                : [];
            if (classes.length > 0) {
                part += '.' + classes.map(escapeCss).join('.');
            }
            if (cur.parentElement) {
                const siblings = Array.from(cur.parentElement.children)
                    .filter((sibling) => sibling.tagName === cur.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(cur);
                    if (index >= 0) {
                        part += `:nth-of-type(${index + 1})`;
                    }
                }
            }
            parts.unshift(part);
            if (classes.length > 0) {
                break;
            }
        }
        return parts.join(' > ');
    }

    let scanRoot = document.body;
    if (isEpicStoreHost()) {
        const focused = focusedPurchaseRoot();
        if (focused) scanRoot = focused;
    }
    if (scanRoot === document.body) {
        for (const selector of PRODUCT_ROOT_SELECTORS) {
            const found = document.querySelector(selector);
            if (found) {
                scanRoot = found;
                break;
            }
        }
    }

    // Restrict the scan to the product card / buy box when no explicit
    // PRODUCT_ROOT matches. Walk up from the strongest H1/title heading to
    // an ancestor that contains both the title AND an add-to-cart button —
    // that container is almost always the buy box. This prevents the scan
    // from picking up "related products" prices, footer prices, etc.
    function focusedBuyBoxRoot() {
        const titleSelectors = ['h1', '[itemprop="name"]', '.product_title', '.product-title', '.product-name'];
        let anchor = null;
        let bestLen = 0;
        for (const sel of titleSelectors) {
            for (const el of document.querySelectorAll(sel)) {
                if (!visible(el)) continue;
                const text = normalizeText(el.textContent || '');
                if (text.length < 12) continue;
                if (text.length > bestLen) {
                    bestLen = text.length;
                    anchor = el;
                }
            }
            if (anchor) break;
        }
        if (!anchor) return null;
        let cur = anchor;
        for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
            if (!cur.querySelectorAll) continue;
            const innerText = normalizeText(cur.innerText || '');
            if (!innerText || innerText.length < 60 || innerText.length > 18000) continue;
            const hasAddToCart = !!cur.querySelector(ADD_TO_CART_SELECTOR);
            if (!hasAddToCart) continue;
            if (!hasPriceText(innerText)) continue;
            return cur;
        }
        return null;
    }

    if (scanRoot === document.body) {
        const focused = focusedBuyBoxRoot();
        if (focused) scanRoot = focused;
    }

    function collectCandidates(root) {
        const out = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const text = (node.textContent || '').trim();
            if (!text) continue;
            const el = node.parentElement;
            if (!el || !visible(el)) continue;
            if (inBadContext(el)) continue;

            let fontSize = 14, fontWeight = 400;
            try {
                const style = window.getComputedStyle(el);
                fontSize = parseFloat(style.fontSize) || 14;
                fontWeight = parseInt(style.fontWeight, 10) || 400;
            } catch (_) {}

            const normalizedText = text.replace(/\s+/g, ' ').trim();
            const textHasCurrency = CURRENCY_SIGNAL.test(normalizedText);
            const textHasPriceSignal = INLINE_PRICE_SIGNAL.test(normalizedText);
            const textLooksSpec = INLINE_SPEC_SIGNAL.test(normalizedText);
            const titleLike = looksTitleLike(el, normalizedText);
            if (PHONE_LIKE.test(normalizedText) && !textHasCurrency && !textHasPriceSignal) continue;
            const freePrice = (
                FREE_PRICE_SIGNAL.test(normalizedText)
                && !FREE_PRICE_EXCLUSION.test(normalizedText)
            );
            if (freePrice) {
                const context = contextScore(el);
                out.push({
                    text: normalizedText,
                    node_text: normalizedText,
                    value: 0,
                    score: context + 60,
                    font_size: fontSize,
                    font_weight: fontWeight,
                    struck: isStruck(el),
                    dealer: isDealer(el),
                    variant_alt: variantAlt(el),
                    near_sale_signal: true,
                    dom_path: domPath(el),
                    selector: elementSelector(el),
                    tag: el.tagName ? el.tagName.toLowerCase() : null,
                    lineage: lineageKeys(el),
                    _el: el,
                });
                continue;
            }

            const matches = Array.from(normalizedText.matchAll(PRICE_FRAGMENT_RE));
            if (matches.length === 0) continue;

            let nearSaleSignal = false;
            let ancestor = el;
            for (let i = 0; i < 4 && ancestor; i++, ancestor = ancestor.parentElement) {
                const txt = (ancestor.textContent || '').slice(0, 400);
                if (SALE_SIGNAL.test(txt)) { nearSaleSignal = true; break; }
            }

            const context = contextScore(el);
            for (const match of matches) {
                const fragment = (match[0] || '').trim();
                const numeric = (fragment.match(/\d[\d,]*(?:\.\d{1,2})?/) || [null])[0];
                if (!numeric) continue;
                const num = parseFloat(numeric.replace(/,/g, ''));
                if (!(num > 0) || num > 50000000) continue;

                const idx = match.index || 0;
                const local = normalizedText.slice(
                    Math.max(0, idx - 16),
                    Math.min(normalizedText.length, idx + fragment.length + 16)
                );
                const hasCurrency = textHasCurrency || CURRENCY_SIGNAL.test(fragment);
                const hasPriceSignal = textHasPriceSignal || INLINE_PRICE_SIGNAL.test(local);
                const hasMeasureUnit = MEASURE_UNIT.test(local);
                const prevChar = idx > 0 ? normalizedText[idx - 1] : '';
                const nextPos = idx + fragment.length;
                const nextChar = nextPos < normalizedText.length ? normalizedText[nextPos] : '';
                const embeddedToken = /[A-Za-z0-9]/.test(prevChar) || /[A-Za-z0-9]/.test(nextChar);
                const embeddedCurrencyPrefix = /[A-Za-z]/.test(prevChar) && /^[A-Za-z]/.test(fragment);
                const embeddedNumericSuffix = /[A-Za-z]/.test(nextChar) && /\d$/.test(fragment);

                if (embeddedCurrencyPrefix || embeddedNumericSuffix) continue;
                if (textLooksSpec && !hasPriceSignal && !hasCurrency && context < 20) continue;
                if (hasMeasureUnit && !hasPriceSignal && !hasCurrency && context < 20) continue;
                if (!hasCurrency && !hasPriceSignal && embeddedToken) continue;
                if (!hasCurrency && !hasPriceSignal && titleLike) continue;
                if (!hasCurrency && !hasPriceSignal && context < 20) continue;

                let score = context;
                if (hasCurrency) score += 30;
                if (hasPriceSignal) score += 24;
                if (textLooksSpec && !hasPriceSignal && !hasCurrency) score -= 18;
                if (hasMeasureUnit && !hasPriceSignal && !hasCurrency) score -= 18;

                out.push({
                    text: fragment,
                    node_text: normalizedText,
                    value: num,
                    score,
                    font_size: fontSize,
                    font_weight: fontWeight,
                    struck: isStruck(el),
                    dealer: isDealer(el),
                    variant_alt: variantAlt(el),
                    near_sale_signal: nearSaleSignal,
                    dom_path: domPath(el),
                    selector: elementSelector(el),
                    tag: el.tagName ? el.tagName.toLowerCase() : null,
                    lineage: lineageKeys(el),
                    _el: el,
                });
            }
        }
        return out;
    }

    let candidates = collectCandidates(scanRoot);
    let usedBodyFallback = false;
    // Safety fallback: only re-scan document.body when the buy-box scope
    // produced ZERO candidates. The previous "<2" threshold was too eager —
    // many product pages have a single visible price in the buy-box, and
    // re-scanning the body lets stray "Rs 4" / footer / related-product
    // numbers compete for "main price" with no way to distinguish them.
    // Downstream reviewers consult ``used_body_fallback`` to refuse
    // overriding structured-data prices when this fired.
    if (candidates.length === 0 && scanRoot !== document.body) {
        usedBodyFallback = true;
        scanRoot = document.body;
        candidates = collectCandidates(scanRoot);
    }

    // Deterministic main-price selection.
    // Prefer non-variant-alt candidates; only fall back to variant-alt
    // candidates when there are no other options (common on pages where
    // the main price is inside the variant-options container).
    const eligible = candidates
        .map((c, i) => ({ ...c, _i: i }))
        .filter(c => !c.struck && !c.dealer);
    let primary = eligible.filter(c => !c.variant_alt);
    if (primary.length === 0) primary = eligible;
    // Rank: highest score, largest font, heaviest weight, then earliest DOM order.
    const mains = primary.sort((a, b) =>
              b.score - a.score
           || b.font_size - a.font_size
           || b.font_weight - a.font_weight
           || a._i - b._i);

    const main = mains[0] || null;

    let original = null;
    if (main) {
        const rankedOriginals = candidates
            .map((candidate, index) => ({
                ...candidate,
                _i: index,
                _pair_score: originalPairScore(main, candidate),
                _lineage_score: sharedLineageScore(main.lineage, candidate.lineage),
                _gap: relativeGap(main.value, candidate.value),
            }))
            .filter(candidate =>
                !candidate.dealer
                && !candidate.variant_alt
                && candidate.value > main.value
                && (main.value === 0 || candidate.value <= main.value * 25)
                && (candidate.struck || candidate.near_sale_signal))
            .sort((a, b) =>
                   b._pair_score - a._pair_score
                || b._lineage_score - a._lineage_score
                || Number(a._gap) - Number(b._gap)
                || b.score - a.score
                || a._i - b._i
            );
        original = rankedOriginals[0] || null;
    }

    const dealer = candidates
        .filter(c => c.dealer)
        .sort((a, b) => b.score - a.score || b.font_size - a.font_size)[0] || null;

    let stock = 'unknown';
    const stockScopes = [];
    const seenScopes = new Set();
    function pushStockScope(scope) {
        if (!scope || !scope.querySelectorAll || seenScopes.has(scope)) return;
        seenScopes.add(scope);
        stockScopes.push(scope);
    }
    if (main && main._el) {
        let cur = main._el.parentElement;
        for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            pushStockScope(cur);
        }
    }
    pushStockScope(scanRoot);
    if (document.body) pushStockScope(document.body);

    for (const scope of stockScopes) {
        const signal = collectStockSignal(scope);
        if (signal) {
            stock = signal.status;
            break;
        }
    }
    if (stock === 'unknown') {
        for (const scope of stockScopes) {
            const text = normalizeText((scope.innerText || '')).toLowerCase();
            const status = stockStatusFromText(text);
            if (status) {
                stock = status;
                break;
            }
        }
    }

    // Platform fingerprint
    let platform = 'generic';
    try {
        if (document.querySelector('.ty-price, .ty-price-num, .ty-price-now, .ty-productPage-price, [class*="ty-product-block"]')) {
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
        main: publicCandidate(main),
        original: publicCandidate(original),
        dealer: publicCandidate(dealer),
        candidates: candidates.slice(0, 30).map(publicCandidate),
        stock,
        platform,
        used_body_fallback: usedBodyFallback,
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
            "used_body_fallback": False,
        }


_SELECTOR_LAB_FIELDS = (
    "title",
    "price",
    "discounted_price",
    "dealer_price",
    "stock_status",
    "image",
)

_SELECTOR_LAB_PAYMENT_RE = re.compile(
    r"\b(koko|installments?|today|30\s*days|60\s*days|credit\s*card|"
    r"transaction\s*fee|webxpay|bank\s*rates|buy\s*now,\s*pay\s*later|total)\b",
    re.IGNORECASE,
)
_SELECTOR_LAB_RELATED_RE = re.compile(
    r"\b(related|you\s*might\s*also\s*be\s*interested|recommend|upsell|cross[\s-]?sell)\b",
    re.IGNORECASE,
)

_SELECTOR_LAB_JS = r"""() => {
    function visible(el) {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden'
            && parseFloat(s.opacity || '1') > 0;
    }

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function short(value, limit) {
        const text = normalizeText(value);
        if (!text) return '';
        if (text.length <= limit) return text;
        return text.slice(0, limit - 1) + '…';
    }

    function escapeCss(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    function elementSelector(el) {
        if (!el || !el.tagName) return null;
        if (el.id) {
            const byId = `#${escapeCss(el.id)}`;
            try {
                if (document.querySelectorAll(byId).length === 1) return byId;
            } catch (_) {}
        }

        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
            let part = cur.tagName.toLowerCase();
            const classes = Array.from(cur.classList || [])
                .filter((cls) =>
                    cls
                    && cls.length < 48
                    && !/^(active|selected|current|focus|hover|open|show|hidden|disabled)$/.test(cls)
                )
                .slice(0, 2);
            if (classes.length) {
                const withClasses = part + classes.map((cls) => `.${escapeCss(cls)}`).join('');
                try {
                    if (document.querySelectorAll(withClasses).length === 1) return withClasses;
                } catch (_) {}
                part = withClasses;
            }
            if (cur.parentElement) {
                const siblings = Array.from(cur.parentElement.children)
                    .filter((child) => child.tagName === cur.tagName);
                if (siblings.length > 1) {
                    part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
                }
            }
            parts.unshift(part);
            const joined = parts.join(' > ');
            try {
                if (document.querySelectorAll(joined).length === 1) return joined;
            } catch (_) {}
            if (parts.length >= 5) break;
            cur = cur.parentElement;
        }
        return parts.join(' > ') || el.tagName.toLowerCase();
    }

    function domPath(el) {
        const parts = [];
        let cur = el;
        for (let i = 0; i < 5 && cur; i += 1, cur = cur.parentElement) {
            const cls = typeof cur.className === 'string'
                ? cur.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
                : '';
            parts.push(cur.tagName.toLowerCase() + (cls ? '.' + cls : ''));
        }
        return parts.reverse().join(' > ');
    }

    function isStruck(el) {
        let cur = el;
        for (let i = 0; i < 5 && cur; i += 1, cur = cur.parentElement) {
            const tag = cur.tagName;
            if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return true;
            try {
                const style = window.getComputedStyle(cur);
                const td = style.textDecorationLine || style.textDecoration || '';
                if (td.includes('line-through')) return true;
            } catch (_) {}
        }
        return false;
    }

    const PRODUCT_ROOT_SELECTORS = [
        'div.summary.entry-summary',
        '.summary.entry-summary',
        '#product .summary',
        '.product-details-area',
        '.product-view-area',
        '.ty-product-block',
        '.ty-productPage-body',
        '.ty-productPage',
        '#product-info-main',
        '.product__info-container',
        '.product-single__info',
        '.product-page',
        'article.product',
        '[itemtype*="Product"]',
    ];

    const BAD = /cart|basket|checkout|order-summary|order-total|mini-cart|related|similar|recommend|upsell|cross[\s-]?sell|recently[\s-]?viewed|featured|bundle|combo|accessories|meta|nav|menu|header|footer|breadcrumb|review|rating|contact|whatsapp|call|delivery|follow|support|social|topbar|banner|modal|popup|drawer|payment|koko|mintpay|payhere|webxpay|hidden|fixed/i;
    const BAD_TEXT = /\b(related\s+products?|you\s+might\s+also\s+be\s+interested|call\s+us\s+anytime|quick\s+response\s+available|island\s+wide\s+express\s+delivery|contact\s+us|product\s+inquiry|expert\s+support|frequently\s+bought\s+together|customers\s+also\s+bought)\b/i;
    const PRICE_FRAGMENT_RE = /(?:rs\.?|lkr|\u0dbb\u0dd4|\/=|\$|€|£|¥|฿|₹|₽)?\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:\/=|rs\.?|lkr))?/ig;
    const CURRENCY_SIGNAL = /(?:\b(?:rs\.?|lkr|usd|aed|sgd|myr|inr|php|bdt)\b|\u0dbb\u0dd4|\/=|\$|€|£|¥|฿|₹|₽)/i;
    const PRICE_HINT = /\b(?:price|amount|cost|now|current|selling|our[\s-]?price|unit[\s-]?price|per[\s-]?unit|offer)\b/i;
    const OLD_PRICE_HINT = /\b(?:old|regular|retail|list|was|compare|original|mrp|rrp|msrp)\b/i;
    const SALE_HINT = /\b(?:sale|special|offer|discount|save|final|deal)\b/i;
    const DEALER_HINT = /\b(?:dealer|trade|wholesale|b2b|distributor|reseller)\b/i;
    const SPEC_HINT = /\b(?:weight|warranty|model|sku|code|serial|capacity|voltage|memory|mhz|ghz|gb|tb|cm|mm|inch|size|days?|years?|weeks?|months?|spec|specifications?)\b/i;
    const STOCK_HINT = /\b(?:stock|availability|available|sold[\s-]?out|out[\s-]?of[\s-]?stock|pre[\s-]?order|back[\s-]?order|limited|low[\s-]?stock|notify me)\b/i;
    const STOCK_CALL_PRICE = /\b(?:call\s+for\s+price|ask\s+for\s+price|price\s+on\s+request)\b/i;
    const STOCK_CONTACT = /\b(?:contact\s+us|contact\s+for\s+price|message\s+us|whatsapp\s+us|inquire\s+now|send\s+inquiry)\b/i;
    const STOCK_DISCONTINUED = /\b(?:discontinued|end\s+of\s+life|eol)\b/i;
    const STOCK_OUT = /\b(?:out[\s-]?of[\s-]?stock|sold[\s-]?out|unavailable|not available)\b/i;
    const STOCK_IN = /\b(?:in[\s-]?stock|available|add[\s-]?to[\s-]?cart|buy[\s-]?now|order[\s-]?now|purchase)\b/i;
    const STOCK_LIMITED = /\b(?:limited[\s-]?stock|limited[\s-]?availability|low[\s-]?stock|few[\s-]?left|only\s+\d+\s+left|last\s+\d+)\b/i;
    const STOCK_PREORDER = /\b(?:pre[\s-]?order|pre[\s-]?sale|coming soon|notify me)\b/i;
    const STOCK_BACKORDER = /\b(?:back[\s-]?order|on[\s-]?backorder)\b/i;
    const STOCK_PAYMENT_NOISE = /\b(?:installments?|credit[\s-]?card|debit[\s-]?card|webxpay|bank[\s-]?rates|buy[\s-]?now,\s*pay[\s-]?later|koko|mintpay|payhere)\b/i;
    const IMAGE_HINT = /product|gallery|main|primary|featured|zoom|hero/i;

    let root = document.body;
    let rootSelector = 'body';
    for (const selector of PRODUCT_ROOT_SELECTORS) {
        const found = document.querySelector(selector);
        if (found) {
            root = found;
            rootSelector = selector;
            break;
        }
    }

    function looksLikeFocusedRoot(el) {
        if (!el || !el.querySelectorAll) return false;
        const text = normalizeText(el.innerText || '');
        if (!text || text.length < 80 || text.length > 15000) return false;
        if (!el.querySelector('h1, [itemprop="name"], .product_title, .product-title, .product-name')) {
            return false;
        }
        if (!el.querySelector('button, input[type="submit"], [role="button"], .add-to-cart, .buy-now, #add-to-cart-button, [data-action*="cart"]')) {
            return false;
        }
        return /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?/.test(text) || /(?:rs\.?|lkr|\$|€|£|¥|₹|฿)\s*\d{3,}/i.test(text);
    }

    if (root === document.body) {
        const titleCandidates = Array.from(document.querySelectorAll('h1, [itemprop="name"], .product_title, .product-title, .product-name'))
            .filter((el) => visible(el))
            .map((el) => ({
                el,
                text: normalizeText(el.textContent || ''),
            }))
            .filter((item) => item.text.length >= 12)
            .sort((a, b) => b.text.length - a.text.length);
        const anchor = titleCandidates.length > 0 ? titleCandidates[0].el : null;
        let cur = anchor;
        for (let i = 0; i < 6 && cur; i += 1, cur = cur.parentElement) {
            if (looksLikeFocusedRoot(cur)) {
                root = cur;
                rootSelector = elementSelector(cur) || 'focused-product-root';
                break;
            }
        }
    }

    let platform = 'generic';
    try {
        if (document.querySelector('.ty-price, .ty-price-num, .ty-price-now, .ty-productPage-price, [class*="ty-product-block"]')) {
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

    function parseStock(text) {
        const rawLines = String(text || '')
            .split(/\n+/)
            .map((line) => normalizeText(line).toLowerCase())
            .filter(Boolean);
        const firstLine = rawLines[0] || '';
        const value = normalizeText(text).toLowerCase();
        if (!value) return null;
        if (STOCK_PAYMENT_NOISE.test(value)) return null;
        if (firstLine && firstLine.length <= 80) {
            if (STOCK_CALL_PRICE.test(firstLine)) return 'call_for_price';
            if (STOCK_DISCONTINUED.test(firstLine)) return 'discontinued';
            if (STOCK_OUT.test(firstLine)) return 'out_of_stock';
            if (STOCK_PREORDER.test(firstLine)) return 'preorder';
            if (STOCK_BACKORDER.test(firstLine)) return 'backorder';
            if (STOCK_LIMITED.test(firstLine)) return 'limited';
            if (STOCK_IN.test(firstLine)) return 'in_stock';
        }
        if (STOCK_CALL_PRICE.test(value)) return 'call_for_price';
        if (STOCK_CONTACT.test(value)) return 'contact_store';
        if (STOCK_DISCONTINUED.test(value)) return 'discontinued';
        if (STOCK_OUT.test(value)) return 'out_of_stock';
        if (STOCK_PREORDER.test(value)) return 'preorder';
        if (STOCK_BACKORDER.test(value)) return 'backorder';
        if (STOCK_LIMITED.test(value)) return 'limited';
        if (STOCK_IN.test(value)) return 'in_stock';
        return null;
    }

    function inBadContext(el) {
        let cur = el;
        for (let i = 0; i < 6 && cur; i += 1, cur = cur.parentElement) {
            const meta = [
                cur.className || '',
                cur.id || '',
                cur.getAttribute && cur.getAttribute('aria-label') || '',
            ].join(' ');
            if (BAD.test(meta)) return true;
            const text = normalizeText((cur.innerText || cur.textContent || '').slice(0, 1200));
            if (text && BAD_TEXT.test(text)) return true;
        }
        return false;
    }

    function addCandidate(store, seen, el, data) {
        const selector = data.selector || elementSelector(el);
        if (!selector) return;
        const kindHints = Array.from(new Set((data.kind_hints || []).filter(Boolean)));
        const sample = short(data.sample || data.text || '', 120);
        const key = [selector, sample, kindHints.join('|'), data.source || 'dom'].join('::');
        if (seen.has(key)) return;
        seen.add(key);
        store.push({
            selector,
            dom_path: data.dom_path || domPath(el),
            text: short(data.text || '', 220) || null,
            sample: sample || null,
            value: data.value ?? null,
            stock_status: data.stock_status || null,
            tag: (el.tagName || '').toLowerCase(),
            source: data.source || 'dom',
            confidence: data.confidence || 0,
            kind_hints: kindHints,
            reason: data.reason || null,
        });
    }

    const candidates = [];
    const seen = new Set();

    const titleSelectors = [
        'h1',
        '[itemprop="name"]',
        '.product_title',
        '.product-title',
        '.product-name',
        '.ty-product-block-title',
        '.page-title .base',
    ];
    for (const selector of titleSelectors) {
        const pool = root.querySelectorAll(selector).length
            ? root.querySelectorAll(selector)
            : document.querySelectorAll(selector);
        for (const el of pool) {
            if (!visible(el)) continue;
            const text = normalizeText(el.textContent || '');
            if (!text || text.length < 4) continue;
            const confidence = el.tagName === 'H1' ? 92 : 76;
            addCandidate(candidates, seen, el, {
                text,
                sample: text,
                source: 'title',
                confidence,
                kind_hints: ['title'],
                reason: selector,
            });
        }
    }

    const imagePool = root.querySelectorAll('img').length
        ? root.querySelectorAll('img')
        : document.querySelectorAll('img');
    for (const el of imagePool) {
        const src = normalizeText(el.currentSrc || el.getAttribute('src') || '');
        if (!src || /^data:/.test(src)) continue;
        const info = [
            el.className || '',
            el.id || '',
            el.getAttribute('alt') || '',
        ].join(' ');
        const score = 48
            + ((el.clientWidth || 0) >= 180 ? 18 : 0)
            + ((el.clientHeight || 0) >= 180 ? 12 : 0)
            + (IMAGE_HINT.test(info) ? 18 : 0);
        addCandidate(candidates, seen, el, {
            text: src,
            sample: src,
            source: 'image',
            confidence: score,
            kind_hints: ['image'],
            reason: short(info, 80) || 'img',
        });
    }

    const pool = Array.from(root.querySelectorAll('*')).slice(0, 1200);
    for (const el of pool) {
        const tag = (el.tagName || '').toLowerCase();
        if (!tag || ['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) continue;
        if (!visible(el) && tag !== 'input') continue;

        const rawText = tag === 'input'
            ? normalizeText(el.value || el.getAttribute('value') || '')
            : normalizeText(el.innerText || el.textContent || '');
        const text = rawText.length > 220 ? rawText.slice(0, 220) : rawText;
        const meta = [
            el.className || '',
            el.id || '',
            el.getAttribute('itemprop') || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('name') || '',
        ].join(' ');

        if (BAD.test(meta) || inBadContext(el)) continue;

        if (text && (STOCK_HINT.test(text) || tag === 'button' || tag === 'a' || tag === 'input')) {
            const disabled = !!el.disabled || el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true';
            let stockStatus = parseStock(text + ' ' + meta);
            if (!stockStatus && disabled && /add[\s-]?to[\s-]?cart|buy[\s-]?now|order[\s-]?now|purchase|checkout/i.test(text)) {
                stockStatus = 'out_of_stock';
            }
            if (stockStatus) {
                let confidence = 44;
                if (/stock|availability/i.test(text)) confidence += 22;
                if (tag === 'button' || tag === 'input') confidence += 12;
                if (/add[\s-]?to[\s-]?cart|buy[\s-]?now|order[\s-]?now|purchase|checkout|out[\s-]?of[\s-]?stock|sold[\s-]?out|pre[\s-]?order|notify me/i.test(text)) {
                    confidence += 22;
                }
                if (/\bavailable\b/i.test(text) && !/\bstock|availability\b/i.test(text) && tag !== 'button' && tag !== 'input') {
                    confidence -= 12;
                }
                addCandidate(candidates, seen, el, {
                    text,
                    sample: text,
                    source: 'stock',
                    confidence,
                    stock_status: stockStatus,
                    kind_hints: ['stock_status'],
                    reason: short(meta || text, 80),
                });
            }
        }

        if (!text || text.length > 180) continue;
        const matches = Array.from(text.matchAll(PRICE_FRAGMENT_RE));
        if (matches.length === 0) continue;

        let fontSize = 14;
        try {
            fontSize = parseFloat(window.getComputedStyle(el).fontSize) || 14;
        } catch (_) {}

        for (const match of matches) {
            const fragment = normalizeText(match[0] || '');
            const numeric = (fragment.match(/\d[\d,]*(?:\.\d{1,2})?/) || [null])[0];
            if (!numeric) continue;
            const value = parseFloat(numeric.replace(/,/g, ''));
            if (!(value > 0) || value > 50000000) continue;

            const idx = match.index || 0;
            const prevChar = idx > 0 ? text[idx - 1] : '';
            const nextPos = idx + fragment.length;
            const nextChar = nextPos < text.length ? text[nextPos] : '';
            const embeddedCurrencyPrefix = /[A-Za-z]/.test(prevChar) && /^[A-Za-z]/.test(fragment);
            const embeddedNumericSuffix = /[A-Za-z]/.test(nextChar) && /\d$/.test(fragment);
            if (embeddedCurrencyPrefix || embeddedNumericSuffix) continue;

            const hasCurrency = CURRENCY_SIGNAL.test(fragment) || CURRENCY_SIGNAL.test(text);
            const hasPriceHint = PRICE_HINT.test(text) || PRICE_HINT.test(meta);
            const hasOldHint = OLD_PRICE_HINT.test(text) || OLD_PRICE_HINT.test(meta) || isStruck(el);
            const hasSaleHint = SALE_HINT.test(text) || SALE_HINT.test(meta);
            const hasDealerHint = DEALER_HINT.test(text) || DEALER_HINT.test(meta);
            const looksSpec = SPEC_HINT.test(text);

            if (!hasCurrency && !hasPriceHint && !hasOldHint && !hasSaleHint && !hasDealerHint) {
                if (looksSpec || value < 1000 || fontSize < 16) continue;
            }

            const kindHints = [];
            if (hasDealerHint) {
                kindHints.push('dealer_price');
            } else {
                if (hasOldHint) kindHints.push('price');
                if (hasSaleHint) kindHints.push('discounted_price');
                if (kindHints.length === 0) {
                    kindHints.push('price', 'discounted_price');
                }
            }

            let confidence = 34;
            if (hasCurrency) confidence += 28;
            if (hasPriceHint) confidence += 20;
            if (hasOldHint || hasSaleHint) confidence += 14;
            if (hasDealerHint) confidence += 10;
            confidence += Math.min(18, Math.round(fontSize));

            addCandidate(candidates, seen, el, {
                text,
                sample: fragment,
                source: 'price',
                confidence,
                value,
                kind_hints: kindHints,
                reason: short(meta || text, 90),
            });
        }
    }

    candidates.sort((a, b) =>
        b.confidence - a.confidence
        || ((b.value || 0) - (a.value || 0))
        || String(a.selector).localeCompare(String(b.selector)));

    return {
        platform,
        root_selector: rootSelector,
        candidates: candidates.slice(0, 180),
    };
}"""


async def _run_selector_lab(page: Page) -> dict:
    try:
        return await page.evaluate(_SELECTOR_LAB_JS)
    except Exception as e:
        logger.debug("Selector lab error: %s", e)
        return {
            "platform": "generic",
            "root_selector": None,
            "candidates": [],
        }


def _lab_profile(url: str) -> Optional[SelectorLabProfile]:
    matched = _find_site_profile(url)
    if not matched:
        return None
    hostname = _normalize_hostname(url) or matched.hostname
    selectors = {field: matched.selectors.get(field) for field in _SELECTOR_LAB_FIELDS}
    return SelectorLabProfile(
        hostname=hostname,
        matched_hostname=matched.hostname,
        platform=matched.platform,
        wait_for=matched.wait_for,
        selectors=selectors,
    )


def _selector_lab_sort_key(candidate: SelectorLabCandidate) -> tuple[Any, ...]:
    return (
        -candidate.confidence,
        0 if candidate.source == "probe" else 1,
        -(candidate.value or 0),
        candidate.selector,
        candidate.sample or candidate.text or "",
    )


def _selector_lab_candidate_from_item(
    item: dict[str, Any],
    *,
    source_fallback: str = "dom",
) -> Optional[SelectorLabCandidate]:
    selector = str(item.get("selector") or "").strip()
    if not selector:
        return None
    kind_hints = list(
        dict.fromkeys(
            str(kind)
            for kind in (item.get("kind_hints") or [])
            if kind
        )
    )
    return SelectorLabCandidate(
        selector=selector,
        dom_path=item.get("dom_path"),
        text=item.get("text"),
        sample=item.get("sample") or item.get("text"),
        value=item.get("value"),
        stock_status=item.get("stock_status"),
        tag=item.get("tag"),
        source=str(item.get("source") or source_fallback),
        confidence=int(item.get("confidence", 0) or 0),
        kind_hints=kind_hints,
        reason=item.get("reason"),
    )


def _smart_scan_candidate_matches(
    item: dict[str, Any],
    target: Optional[dict[str, Any]],
) -> bool:
    if not target:
        return False
    item_selector = str(item.get("selector") or "")
    target_selector = str(target.get("selector") or "")
    if (
        item_selector
        and target_selector
        and item_selector == target_selector
        and item.get("value") == target.get("value")
    ):
        return True
    if (
        item.get("dom_path")
        and item.get("dom_path") == target.get("dom_path")
        and item.get("value") == target.get("value")
    ):
        return True
    return (
        item.get("text") == target.get("text")
        and item.get("value") == target.get("value")
    )


def _smart_scan_candidate_to_selector_candidate(
    item: dict[str, Any],
    *,
    main: Optional[dict[str, Any]],
    original: Optional[dict[str, Any]],
    dealer: Optional[dict[str, Any]],
) -> Optional[SelectorLabCandidate]:
    selector = str(item.get("selector") or "").strip()
    if not selector:
        return None

    is_main = _smart_scan_candidate_matches(item, main)
    is_original = _smart_scan_candidate_matches(item, original)
    is_dealer = _smart_scan_candidate_matches(item, dealer) or bool(item.get("dealer"))
    has_original = original is not None

    kind_hints: list[str] = []
    reason_parts: list[str] = []
    confidence = int(item.get("score", 0) or 0) + 42

    if is_dealer:
        kind_hints.append("dealer_price")
        reason_parts.append(
            "Probe matched dealer price"
            if _smart_scan_candidate_matches(item, dealer)
            else "Probe dealer price candidate"
        )
        confidence += 18
    else:
        if is_original:
            kind_hints.append("price")
            reason_parts.append("Probe matched original/compare price")
            confidence += 20
        elif is_main:
            kind_hints.append("discounted_price" if has_original else "price")
            reason_parts.append(
                "Probe matched current sale price"
                if has_original
                else "Probe matched current main price"
            )
            confidence += 24
        else:
            if bool(item.get("struck")) or bool(item.get("near_sale_signal")):
                kind_hints.append("price")
            if not kind_hints:
                kind_hints.extend(["price", "discounted_price"])
            reason_parts.append("Probe price-like node")

    if bool(item.get("variant_alt")) and not (is_main or is_original or is_dealer):
        confidence -= 14
        reason_parts.append("variant option")

    kind_hints = list(dict.fromkeys(kind_hints))
    text = str(item.get("node_text") or "").strip() or None
    sample = str(item.get("text") or "").strip() or text
    reason = "; ".join(dict.fromkeys(reason_parts)) or None
    return SelectorLabCandidate(
        selector=selector,
        dom_path=item.get("dom_path"),
        text=text,
        sample=sample,
        value=item.get("value"),
        stock_status=None,
        tag=item.get("tag"),
        source="probe",
        confidence=max(0, min(99, confidence)),
        kind_hints=kind_hints,
        reason=reason,
    )


def _merge_selector_lab_candidates(
    *candidate_groups: list[SelectorLabCandidate],
) -> list[SelectorLabCandidate]:
    merged: dict[tuple[str, Any, Any, str], SelectorLabCandidate] = {}
    for group in candidate_groups:
        for candidate in group:
            key = (
                candidate.selector,
                candidate.value,
                candidate.stock_status,
                candidate.sample or candidate.text or "",
            )
            existing = merged.get(key)
            if existing is None:
                merged[key] = candidate.model_copy(deep=True)
                continue

            existing.kind_hints = list(
                dict.fromkeys([*existing.kind_hints, *candidate.kind_hints])
            )
            existing.confidence = max(existing.confidence, candidate.confidence)
            if candidate.source == "probe" and existing.source != "probe":
                existing.source = "probe"
            if candidate.text and (
                not existing.text or len(candidate.text) > len(existing.text)
            ):
                existing.text = candidate.text
            if candidate.sample and not existing.sample:
                existing.sample = candidate.sample
            if candidate.dom_path and not existing.dom_path:
                existing.dom_path = candidate.dom_path
            if candidate.tag and not existing.tag:
                existing.tag = candidate.tag
            if candidate.reason and candidate.reason != existing.reason:
                if existing.reason:
                    existing.reason = f"{existing.reason}; {candidate.reason}"
                else:
                    existing.reason = candidate.reason

    return sorted(merged.values(), key=_selector_lab_sort_key)[:180]


def _suggest_selector_assignments(
    candidates: list[SelectorLabCandidate],
    profile: Optional[SelectorLabProfile],
) -> dict[str, Optional[str]]:
    def is_noise(candidate: SelectorLabCandidate) -> bool:
        blob = " ".join(
            part
            for part in (
                candidate.sample,
                candidate.text,
                candidate.reason,
                candidate.selector,
                candidate.dom_path,
            )
            if part
        )
        return bool(
            _SELECTOR_LAB_PAYMENT_RE.search(blob)
            or _SELECTOR_LAB_RELATED_RE.search(blob)
        )

    def best_candidate(field: str) -> Optional[SelectorLabCandidate]:
        ranked = [candidate for candidate in candidates if field in candidate.kind_hints]
        if not ranked:
            return None

        def rank(candidate: SelectorLabCandidate) -> tuple[int, ...]:
            hints = list(dict.fromkeys(candidate.kind_hints))
            exact = hints == [field]
            matched = "matched" in (candidate.reason or "").lower()
            return (
                0 if is_noise(candidate) else 1,
                1 if exact else 0,
                1 if matched else 0,
                1 if len(hints) == 1 else 0,
                1 if candidate.source == "probe" else 0,
                candidate.confidence,
                int(candidate.value or 0),
            )

        ranked.sort(key=rank, reverse=True)
        candidate = ranked[0]
        hints = list(dict.fromkeys(candidate.kind_hints))
        reason = (candidate.reason or "").lower()
        if field == "discounted_price" and hints != [field]:
            if "current sale price" not in reason:
                return None
        if field == "dealer_price" and hints != [field]:
            if "dealer price" not in reason:
                return None
        return candidate

    suggested: dict[str, Optional[str]] = {
        "wait_for": profile.wait_for if profile else None,
    }
    for field in _SELECTOR_LAB_FIELDS:
        suggested[field] = profile.selectors.get(field) if profile else None

    for field in _SELECTOR_LAB_FIELDS:
        if suggested.get(field):
            continue
        candidate = best_candidate(field)
        if candidate:
            suggested[field] = candidate.selector

    if not suggested.get("wait_for"):
        for field in ("discounted_price", "price", "stock_status", "title"):
            if suggested.get(field):
                suggested["wait_for"] = suggested[field]
                break

    return suggested


async def _populate_selector_lab(
    page: Page,
    url: str,
    config: ScrapeConfig,
    nav_config: ScrapeConfig,
    response: SelectorLabResponse,
) -> None:
    """Run lab + smart-scan on an already-navigated page and fill response."""
    response.final_url = page.url
    response.hostname = _normalize_hostname(page.url or url)

    is_facebook_marketplace = (
        _is_facebook_marketplace_url(url)
        or _is_facebook_marketplace_url(page.url)
        or nav_config.platform == "facebook-marketplace"
    )

    lab = await _run_selector_lab(page)
    smart = await _run_smart_scan(page)
    buy_area_data = await _run_buy_area_dump(page)
    response.platform = (
        "facebook-marketplace"
        if is_facebook_marketplace
        else (lab.get("platform") or smart.get("platform") or "generic")
    )
    response.root_selector = lab.get("root_selector")
    response.buy_area = _coerce_buy_area_items(buy_area_data.get("items") or [])
    response.buy_area_root = buy_area_data.get("root_selector") or None
    lab_candidates = [
        candidate
        for item in (lab.get("candidates") or [])
        if (candidate := _selector_lab_candidate_from_item(item))
    ]
    probe_candidates = [
        candidate
        for item in (smart.get("candidates") or [])
        if (
            candidate := _smart_scan_candidate_to_selector_candidate(
                item,
                main=smart.get("main"),
                original=smart.get("original"),
                dealer=smart.get("dealer"),
            )
        )
    ]
    response.candidates = _merge_selector_lab_candidates(
        probe_candidates,
        lab_candidates,
    )

    effective = _apply_site_profile(url, config)
    if effective.storage_state_path:
        response.extracted = await scrape(url, effective)
    else:
        response.extracted = await scrape_with_open_page(
            page,
            effective,
            platform_hint=response.platform,
        )
    if is_facebook_marketplace:
        response.candidates = (
            _facebook_selector_candidates_from_result(response.extracted)
            + response.candidates
        )
    response.suggested_assignments = _suggest_selector_assignments(
        response.candidates,
        response.current_profile,
    )

    if response.current_profile:
        note = f"Matched saved profile: {response.current_profile.matched_hostname}"
        if response.current_profile.matched_hostname != response.current_profile.hostname:
            note += f" for {response.current_profile.hostname}"
        response.notes.append(note)
    if response.hostname and response.hostname.endswith("mskcomputers.lk"):
        response.notes.append(
            "MSK product pages include KOKO/installment and related-product prices. "
            "Prefer the main LKR amount in the top product block, then test on a few products before saving."
        )
    if response.root_selector:
        response.notes.append(f"Detected product root: {response.root_selector}")
    if probe_candidates:
        response.notes.append(
            f"Merged {len(probe_candidates)} probe smart-scan candidate"
            f"{'' if len(probe_candidates) == 1 else 's'} into Selector Lab."
        )
    response.notes.append(
        f"Collected {len(response.candidates)} selector candidate"
        f"{'' if len(response.candidates) == 1 else 's'}."
    )
    if not response.candidates:
        response.notes.append("No useful candidates were found on the page.")
    if response.buy_area:
        response.notes.append(
            f"Captured {len(response.buy_area)} buy-area item"
            f"{'' if len(response.buy_area) == 1 else 's'}"
            + (f" inside {response.buy_area_root}" if response.buy_area_root else "")
            + "."
        )
    elif response.extracted.price is not None:
        response.notes.append(
            "No visible buy-box detected. The extracted price came from "
            "server-rendered metadata only — qualifiers (Free with PS Plus, "
            "Game Trial, Coming Soon) and sale badges live in the React "
            "buy-area which is not visible to the headless browser on this "
            "page."
        )


async def inspect_selectors(url: str, config: ScrapeConfig) -> SelectorLabResponse:
    response = SelectorLabResponse(url=url)
    current_profile = _lab_profile(url)
    response.current_profile = current_profile
    headers = dict(config.headers)
    matched = _find_site_profile(url)
    if matched:
        headers = {**matched.headers, **headers}
    nav_config = ScrapeConfig(
        use_playwright=config.use_playwright,
        wait_for=config.wait_for,
        wait_timeout=config.wait_timeout,
        selectors=config.selectors,
        cookies=config.cookies,
        headers=headers,
        storage_state_path=config.storage_state_path,
        platform=config.platform,
    )

    # First attempt: shared headless Chromium.
    challenge_blocked = False
    context = await _open_context(nav_config)
    page = await context.new_page()
    try:
        ready = await _navigate(page, url, nav_config)
        if not ready:
            challenge_blocked = True
        else:
            await _populate_selector_lab(page, url, config, nav_config, response)
            return response
    finally:
        await context.close()

    # Bot challenge — retry the inspection through SeleniumBase stealth Chrome
    # so the Selector Lab also works on Cloudflare-protected stores.
    if challenge_blocked and _playwright is not None:
        logger.info(
            "Selector-lab bot challenge on %s — retrying via SeleniumBase stealth", url
        )
        async with _stealth.stealth_navigate(_playwright, url, nav_config) as page:
            if page is not None:
                try:
                    await _settle_after_stealth_navigation(page, nav_config)
                    if not await _detected_challenge(page):
                        await _populate_selector_lab(
                            page, url, config, nav_config, response
                        )
                        response.notes.insert(
                            0,
                            "Bot challenge bypassed via SeleniumBase stealth Chrome.",
                        )
                        return response
                    logger.warning(
                        "Stealth selector-lab also detected challenge on %s", url
                    )
                except Exception as exc:
                    logger.error("Stealth selector-lab failed for %s: %s", url, exc)

    response.final_url = url
    response.hostname = response.hostname or _normalize_hostname(url)
    response.extracted = _bot_challenge_result()
    response.notes.extend([
        _BOT_CHALLENGE_NOTE,
        _BOT_CHALLENGE_SESSION_NOTE,
    ])
    return response


def _smart_scan_result_from_data(data: dict[str, Any]) -> ScrapeResult:
    result = ScrapeResult()
    main = data.get("main")
    original = data.get("original")
    dealer = data.get("dealer")

    def candidate_value(candidate: dict[str, Any]) -> Optional[float]:
        text = candidate.get("text")
        parsed = _parse_price(text)
        if parsed is not None:
            return parsed
        value = candidate.get("value")
        if value == 0 and text and _FREE_PRICE_RE.search(str(text)):
            return None
        return value

    if main and not _is_installment_price(main.get("text")):
        value = candidate_value(main)
        if value is not None:
            result.price = value
            result.raw_price = main.get("text")

    if original and not _is_installment_price(original.get("text")):
        # Convention: price = retail/original, discounted_price = sale/current
        if result.price is not None:
            result.discounted_price = result.price
            result.raw_discounted = result.raw_price
            original_value = candidate_value(original)
            if original_value is not None:
                result.price = original_value
                result.raw_price = original.get("text")
            else:
                _clear_discount(result)

    if dealer and not _is_installment_price(dealer.get("text")):
        dealer_value = candidate_value(dealer)
        if dealer_value is not None:
            result.dealer_price = dealer_value
            result.raw_dealer = dealer.get("text")

    result.stock_status = data.get("stock", "unknown") or "unknown"
    return _normalize_scrape_result(result)


async def _try_smart_scan(page: Page) -> ScrapeResult:
    data = await _run_smart_scan(page)
    result = _sanitize_smart_scan_result(_smart_scan_result_from_data(data), data)

    if result.price is not None:
        logger.info(
            "Smart scan hit: price=%s disc=%s dealer=%s",
            result.price, result.discounted_price, result.dealer_price,
        )
    return result


# ── Strategy 4: Custom selectors (user-configured override) ──────────────────

async def _apply_custom(
    page: Page, config: ScrapeConfig, base: ScrapeResult
) -> tuple[ScrapeResult, set[str]]:
    """Apply user-supplied selectors and report which fields actually produced
    a value. Locked fields are authoritative — downstream review must not
    override them with smart-scan picks."""
    sel = config.selectors
    product_root = await _get_product_root(page)
    # When a confident buy-box was detected, price-related selectors must
    # stay inside it. Page-wide fallback is a bleed source — a Woo theme's
    # `.price > .amount` matches related-products, recently-viewed, and
    # mini-cart blocks too. Title and stock can still fall back page-wide
    # because their selectors are usually specific (`.product_title`,
    # `.stock`) and the cost of missing them is worse than the bleed.
    price_scope_only = product_root is not None

    async def get_text(
        selector: Optional[str],
        *,
        root=None,
        allow_page_fallback: bool = True,
    ) -> Optional[str]:
        # Iterate over every match and return the first one with non-empty
        # inner_text.
        #
        # Two reasons we need iteration:
        #
        # 1. Variant-aware Woo themes (Woody, WoodMart) ship multiple
        #    .price blocks, only the currently-selected variant block has
        #    visible text. query_selector returns the first DOM-order
        #    match, which can be a hidden placeholder.
        #
        # 2. Page-wide fallback (when allowed) covers the rare template
        #    where the buy-box detector returns nothing — there the
        #    main product's price is the first match in DOM order anyway.
        if not selector:
            return None
        if root is not None:
            try:
                els = await root.query_selector_all(selector)
            except Exception:
                els = []
            for el in els:
                text = await _read_element_text(el)
                if text:
                    return text
            if not allow_page_fallback:
                return None
        try:
            els = await page.query_selector_all(selector)
        except Exception:
            return None
        for el in els:
            text = await _read_element_text(el)
            if text:
                return text
        return None

    title = await get_text(sel.title, root=product_root)
    raw_price = await get_text(
        sel.price,
        root=product_root,
        allow_page_fallback=not price_scope_only,
    )
    raw_disc = await get_text(
        sel.discounted_price,
        root=product_root,
        allow_page_fallback=not price_scope_only,
    )
    raw_dealer = await get_text(
        sel.dealer_price,
        root=product_root,
        allow_page_fallback=not price_scope_only,
    )
    stock_raw = await get_text(sel.stock_status, root=product_root)

    if _is_installment_price(raw_price):
        raw_price = None
    if _is_installment_price(raw_disc):
        raw_disc = None
    if _is_installment_price(raw_dealer):
        raw_dealer = None

    parsed_price = _parse_price(raw_price)
    parsed_disc = _parse_price(raw_disc)
    parsed_dealer = _parse_price(raw_dealer)
    parsed_stock = _parse_stock(stock_raw) if stock_raw else None

    locks: set[str] = set()
    if sel.title and title:
        locks.add("title")
    if sel.price and parsed_price is not None:
        locks.add("price")
    if sel.discounted_price and parsed_disc is not None:
        locks.add("discounted_price")
    if sel.dealer_price and parsed_dealer is not None:
        locks.add("dealer_price")
    if sel.stock_status and parsed_stock:
        locks.add("stock_status")

    result = ScrapeResult(
        title=title or base.title,
        price=parsed_price if parsed_price is not None else base.price,
        discounted_price=(
            parsed_disc if parsed_disc is not None else base.discounted_price
        ),
        dealer_price=(
            parsed_dealer if parsed_dealer is not None else base.dealer_price
        ),
        stock_status=parsed_stock or base.stock_status,
        raw_price=raw_price or base.raw_price,
        raw_discounted=raw_disc or base.raw_discounted,
        raw_dealer=raw_dealer or base.raw_dealer,
    )
    return _normalize_scrape_result(result), locks


# ── Context factory (shared by scrape() and probe()) ─────────────────────────

# Browser compatibility init script for sites that read common navigator
# fields before rendering product pages.
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

    # Note: keep `extra_http_headers` minimal. Chromium already sends correct
    # `Accept`, `Upgrade-Insecure-Requests`, `sec-ch-ua*` etc. based on its
    # real UA. Overriding those values (or adding them when Chromium already
    # sent them) causes a mismatch that some CDNs / WAFs (nanotek.lk and
    # similar CS-Cart B2B stores) read as bot, responding with a stripped
    # page that's missing the product block. Only `Accept-Language` — paired
    # with locale — is safe to set explicitly.
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
        },
    )

    if config.storage_state_path:
        try:
            storage_state = resolve_storage_state_path(config.storage_state_path)
        except Exception:
            storage_state = None
        if storage_state and storage_state.exists():
            options["storage_state"] = str(storage_state)
            logger.info("Using storage_state from %s", storage_state)

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

_BOT_CHALLENGE_ERROR = (
    "Bot-check challenge is blocking this page. Open the store in a visible "
    "session window, complete the check manually, save the session, then retry. "
    "If the site still blocks automation, use the store API/feed or track it manually."
)

_BOT_CHALLENGE_NOTE = (
    "Unresolved anti-bot challenge detected; extraction stopped before reading "
    "prices so Gabada does not save challenge-page text as product data."
)

_BOT_CHALLENGE_SESSION_NOTE = (
    "Use the store Save session/Refresh session action, complete the check in "
    "the opened browser window, then click Save login to Gabada."
)

_RENDERED_PRODUCT_HINTS_RE = re.compile(
    r"\b(rs\.?|lkr|price|in stock|out of stock|add[\s-]?to[\s-]?cart|"
    r"buy[\s-]?now|sku\s*:|category\s*:)\b",
    re.IGNORECASE,
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
        if any(h in text for h in _CLOUDFLARE_HINTS):
            return True

        # Akamai bot block (PlayStation Store, many enterprise sites).
        # Akamai keeps the page's server-rendered metadata (so JSON-LD still
        # carries a price) but injects an "Access Denied" h1 in place of the
        # real buy-box. Without this detector we silently extract the cached
        # JSON-LD price from a blocked page and treat it as live data.
        return await page.evaluate(
            r"""() => {
                const heads = Array.from(document.querySelectorAll('h1, h2'));
                const hasAccessDenied = heads.some((el) => {
                    if (!el.offsetParent && !el.getClientRects().length) return false;
                    const text = (el.textContent || '').trim();
                    return /^access denied$/i.test(text)
                        || /^you don'?t have permission/i.test(text);
                });
                if (!hasAccessDenied) return false;
                // Be conservative: a real product page that just happens to
                // mention "Access Denied" in copy is fine. Only flag when
                // the page is suspiciously thin (Akamai's block page is
                // typically <12 KB of body text) AND has no buy controls.
                const bodyText = (document.body && document.body.innerText || '');
                if (bodyText.length > 18000) return false;
                const hasBuyControl = !!document.querySelector(
                    '[data-qa*="cart" i], [data-qa*="add-to-library" i], '
                    + '[data-testid*="cart" i], [aria-label*="add to cart" i], '
                    + '[aria-label*="buy now" i], [aria-label*="add to library" i], '
                    + '.add-to-cart, .single_add_to_cart_button, .buy-now, '
                    + '#add-to-cart-button'
                );
                return !hasBuyControl;
            }"""
        )
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


def _bot_challenge_result() -> ScrapeResult:
    return ScrapeResult(
        error=_BOT_CHALLENGE_ERROR,
        review_status="needs_review",
        review_notes=[
            _BOT_CHALLENGE_NOTE,
            _BOT_CHALLENGE_SESSION_NOTE,
        ],
    )


async def _page_has_meaningful_product_content(page: Page) -> bool:
    try:
        payload = await page.evaluate(
            """() => {
                const body = document.body;
                const text = (body && body.innerText || '').trim();
                const hasTitle = !!document.querySelector(
                    'h1, [itemprop="name"], .product_title, .product-title, .product-name'
                );
                return {
                    text: text.slice(0, 4000),
                    hasTitle,
                };
            }"""
        )
    except Exception:
        return False

    text = str(payload.get("text") or "")
    if len(text) < 40:
        return False
    if payload.get("hasTitle") and len(text) >= 120:
        return True
    return bool(_RENDERED_PRODUCT_HINTS_RE.search(text))


async def _wait_for_rendered_product_content(
    page: Page, *, timeout_ms: int = 8000
) -> bool:
    import time as _time

    deadline = _time.monotonic() + (timeout_ms / 1000.0)
    while _time.monotonic() < deadline:
        if await _page_has_meaningful_product_content(page):
            return True
        try:
            await page.wait_for_load_state("networkidle", timeout=1000)
        except Exception:
            pass
        await asyncio.sleep(0.4)
    return await _page_has_meaningful_product_content(page)


async def _wait_for_price_text(page: Page, *, timeout_ms: int = 4000) -> bool:
    """Poll until at least one price-bearing element has visible text.

    Some Woo / Woody / WoodMart themes render hidden placeholder .price
    blocks at SSR time and only fill in the visible block after a JS
    swap. _page_has_meaningful_product_content returns True as soon as
    body text exists, so without this extra poll the engine extracts
    before any .price .amount has text and returns null for both price
    fields.

    Returns True as soon as a candidate is found, so well-behaved sites
    pay roughly one JS round-trip (~50-150 ms). Stays out of the way of
    sites that have no .price markup at all (returns False after the
    timeout — extraction proceeds anyway via JSON-LD / smart scan).
    """
    import time as _time

    deadline = _time.monotonic() + (timeout_ms / 1000.0)
    while _time.monotonic() < deadline:
        try:
            has_text = await page.evaluate(
                """() => {
                    const els = document.querySelectorAll(
                        '.price .amount, .price .woocommerce-Price-amount, '
                        + '[itemprop="price"], [data-qa$="#price"]'
                    );
                    for (const el of els) {
                        if (((el.innerText || el.getAttribute('content') || '').trim()).length > 0) {
                            return true;
                        }
                    }
                    return false;
                }"""
            )
            if has_text:
                return True
        except Exception:
            pass
        await asyncio.sleep(0.4)
    return False


async def _navigate(page: Page, url: str, config: ScrapeConfig) -> bool:
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)

    # Challenge handling: if the landing page is a challenge, give it a
    # chance to auto-resolve before we look for product selectors.
    if await _detected_challenge(page):
        logger.info("Bot-check challenge detected on %s — waiting for clear", url)
        cleared = await _wait_for_challenge_clear(page)
        if not cleared:
            logger.warning("Bot-check challenge did not clear on %s", url)
            return False

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

    if not await _page_has_meaningful_product_content(page):
        settled = await _wait_for_rendered_product_content(page)
        if settled:
            logger.debug("Waited for delayed product content on %s", url)
    # Body text can land before any .price element has visible text on
    # JS-swapped storefronts (Woody / WoodMart / variant Woo themes).
    # Poll a short extra window so extraction sees a populated price block
    # instead of returning null when the swap is in flight.
    if not await _wait_for_price_text(page):
        logger.debug("No price-text element settled within poll window on %s", url)
    if await _detected_challenge(page):
        logger.warning("Bot-check challenge detected after render wait on %s", url)
        return False
    return True


# ── Main scrape function ──────────────────────────────────────────────────────

async def _scrape_url_once(url: str, config: ScrapeConfig) -> ScrapeResult:
    context = await _open_context(config)
    page = await context.new_page()
    challenge_blocked = False

    try:
        ready = await _navigate(page, url, config)
        if not ready:
            challenge_blocked = True
        else:
            result = await scrape_with_open_page(page, config)
            logger.info(
                "Scrape done: %s -> regular=%s discounted=%s dealer=%s stock=%s",
                url,
                result.price,
                result.discounted_price,
                result.dealer_price,
                result.stock_status,
            )
            return result
    except Exception as e:
        logger.error("Scrape failed for %s: %s", url, e)
        return ScrapeResult(error=str(e))
    finally:
        await context.close()

    # The shared headless Chromium hit a bot-check that did not auto-clear.
    # Retry once via SeleniumBase-launched stealth Chrome before giving up,
    # so Cloudflare / DataDome stores still produce a price log entry.
    if challenge_blocked:
        return await _scrape_via_stealth(url, config)
    return _bot_challenge_result()


async def _settle_after_stealth_navigation(page: Page, config: ScrapeConfig) -> None:
    """Wait for the wait_for selector / network idle on a pre-navigated stealth page.

    The page is already at the target URL because SeleniumBase navigated
    before Playwright attached. We only need to wait for the product
    content selector (or network idle) to confirm extraction can run.
    """
    if config.wait_for:
        try:
            await page.wait_for_selector(config.wait_for, timeout=config.wait_timeout)
        except Exception:
            logger.warning(
                "Stealth: wait_for '%s' timed out on %s", config.wait_for, page.url
            )
    else:
        try:
            await page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass


async def _scrape_via_stealth(url: str, config: ScrapeConfig) -> ScrapeResult:
    """Retry a blocked scrape through a SeleniumBase stealth Chrome.

    Returns the standard ``_bot_challenge_result()`` if seleniumbase is
    not installed, the stealth browser failed to start, or the stealth
    page also tripped a challenge.
    """
    if _playwright is None:
        return _bot_challenge_result()
    logger.info("Bot challenge on %s — retrying via SeleniumBase stealth", url)
    async with _stealth.stealth_navigate(_playwright, url, config) as page:
        if page is None:
            return _bot_challenge_result()
        try:
            await _settle_after_stealth_navigation(page, config)
            if await _detected_challenge(page):
                logger.warning("Stealth Chrome also blocked on %s", url)
                return _bot_challenge_result()
            result = await scrape_with_open_page(page, config)
            logger.info(
                "Stealth scrape done: %s -> regular=%s discounted=%s dealer=%s stock=%s",
                url,
                result.price,
                result.discounted_price,
                result.dealer_price,
                result.stock_status,
            )
            return result
        except Exception as e:
            logger.error("Stealth scrape failed for %s: %s", url, e)
            return ScrapeResult(error=str(e))


async def _probe_via_stealth(
    url: str, config: ScrapeConfig, response: ProbeResponse
) -> Optional[ScrapeResult]:
    """Retry probe extraction through stealth Chrome.

    Returns the extracted ``ScrapeResult`` on success so the caller can
    populate ``response.extracted``. Mutates ``response`` to record the
    final URL and a note describing how the page was reached. Returns
    ``None`` if seleniumbase is unavailable or the stealth attempt also
    detected a challenge.
    """
    if _playwright is None:
        return None
    logger.info("Probe bot challenge on %s — retrying via SeleniumBase stealth", url)
    async with _stealth.stealth_navigate(_playwright, url, config) as page:
        if page is None:
            return None
        try:
            await _settle_after_stealth_navigation(page, config)
            response.final_url = page.url
            if await _detected_challenge(page):
                response.notes.append(
                    "Stealth retry also tripped the bot-check; this site needs a "
                    "saved session before Gabada can scrape it."
                )
                return None
            extracted = await scrape_with_open_page(page, config)
            response.notes.append(
                "Bot challenge bypassed via SeleniumBase stealth Chrome; "
                "candidate enumeration was skipped for this probe."
            )
            return extracted
        except Exception as e:
            logger.error("Stealth probe failed for %s: %s", url, e)
            response.notes.append(f"Stealth probe error: {e}")
            return None


# ── Probe (diagnostics) ──────────────────────────────────────────────────────
# Platform defaults now live in ``scraper.site_profiles`` so they can be
# resolved both by the engine and by the ``sites.toml`` loader without a
# circular import.


async def scrape(url: str, config: ScrapeConfig) -> ScrapeResult:
    async with _lock:
        if not _browser:
            raise RuntimeError("Browser not started")

    # Let sites.toml pin a platform / override selectors for this hostname
    # before we touch the network. Unknown hosts pass through untouched.
    config = _apply_site_profile(url, config)

    if _is_facebook_marketplace_url(url):
        return _clear_dealer_price(await _scrape_url_once(url, config))

    if not config.storage_state_path:
        return await _scrape_url_once(url, config)

    public_config = config.model_copy(deep=True)
    public_config.storage_state_path = None

    public_result = await _scrape_url_once(url, public_config)
    authenticated_result = await _scrape_url_once(url, config)
    return _merge_public_and_authenticated_result(
        public_result,
        authenticated_result,
    )


async def probe(url: str, config: ScrapeConfig) -> ProbeResponse:
    """
    Deep-dive diagnostics for a URL. Opens a Playwright context, runs every
    extraction strategy, and returns the raw candidates + detected platform.
    Useful for debugging why a site scrapes incorrectly.
    """
    response = ProbeResponse(url=url)
    # Apply any matching entry from sites.toml so probes reflect the real
    # scraper behaviour that ``scrape()`` will use.
    config = _apply_site_profile(url, config)
    context = await _open_context(config)
    page = await context.new_page()

    try:
        ready = await _navigate(page, url, config)
        response.final_url = page.url
        if not ready:
            # Bot-check on the shared Chromium. Try stealth before reporting
            # the page as blocked so probe diagnostics match what scrape()
            # will actually see on this URL.
            stealth_extracted = await _probe_via_stealth(url, config, response)
            if stealth_extracted is not None:
                response.extracted = stealth_extracted
                return response
            response.extracted = _bot_challenge_result()
            response.notes.extend([
                _BOT_CHALLENGE_NOTE,
                _BOT_CHALLENGE_SESSION_NOTE,
            ])
            return response
        is_facebook_marketplace = (
            _is_facebook_marketplace_url(url)
            or _is_facebook_marketplace_url(page.url)
            or config.platform == "facebook-marketplace"
        )

        # JSON-LD
        jsonld = await _try_json_ld(page)
        if jsonld.price or jsonld.title:
            response.json_ld_found = True
            response.json_ld_name = jsonld.title
            response.json_ld_price = jsonld.price

        # Smart scan + candidates
        data = await _run_smart_scan(page)
        buy_area_data = await _run_buy_area_dump(page)
        response.buy_area = _coerce_buy_area_items(buy_area_data.get("items") or [])
        response.buy_area_root = buy_area_data.get("root_selector") or None
        response.platform = (
            "facebook-marketplace"
            if is_facebook_marketplace
            else (data.get("platform", "generic") or "generic")
        )
        for c in data.get("candidates", []):
            response.candidates.append(ProbeCandidate(
                text=str(c.get("text", ""))[:80],
                value=c.get("value"),
                score=int(c.get("score", 0) or 0),
                font_size=c.get("font_size"),
                font_weight=c.get("font_weight"),
                struck=bool(c.get("struck", False)),
                dealer=bool(c.get("dealer", False)),
                variant_alt=bool(c.get("variant_alt", False)),
                dom_path=c.get("dom_path"),
            ))

        # Run the full scrape waterfall to compute an "extracted" snapshot.
        # When a saved login session is attached, use the normal scrape()
        # entrypoint so non-Facebook sites can preserve public/dealer prices.
        if config.storage_state_path and not is_facebook_marketplace:
            extracted = await scrape(url, config)
        else:
            extracted = await scrape_with_open_page(
                page,
                config,
                platform_hint=response.platform,
            )
        response.extracted = extracted
        if is_facebook_marketplace:
            response.candidates = (
                _facebook_probe_candidates_from_result(extracted)
                + response.candidates
            )

        # Suggested config
        platform = response.platform if response.platform in _PLATFORM_SELECTORS else "generic"
        response.suggested_wait_for = _PLATFORM_WAIT_FOR.get(platform) or None
        response.suggested_selectors = dict(_PLATFORM_SELECTORS[platform])

        if not response.candidates:
            response.notes.append("No price-like text nodes found on this page.")
        if extracted.price is None:
            response.notes.append(
                "No price could be extracted. Likely requires login "
                "(use /scraper/login-session) or a custom selector."
            )
        if extracted.stock_status == "unknown":
            response.notes.append(
                "Stock status could not be determined — "
                "add-to-cart button may be hidden behind login."
            )
        if response.buy_area:
            response.notes.append(
                f"Captured {len(response.buy_area)} buy-area item"
                f"{'' if len(response.buy_area) == 1 else 's'}"
                + (f" inside {response.buy_area_root}" if response.buy_area_root else "")
                + "."
            )
        elif extracted.price is not None:
            # Got a price (typically from JSON-LD / microdata) but no buy-box
            # was detected. PlayStation Store, some enterprise storefronts,
            # and bot-walled sites leak server-rendered metadata while the
            # interactive buy-box never renders. Tell the user the value is
            # metadata-only so they don't trust it as the live displayed price.
            response.notes.append(
                "No visible buy-box could be detected on this page. The "
                "price came from server-rendered metadata (JSON-LD / "
                "microdata) only — Gabada cannot see PS Plus tiers, "
                "qualifiers, or sale badges that may live in the React "
                "buy-area. Consider tracking this product via the API "
                "Catalog or a Custom JSON template instead."
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
    # Facebook Marketplace listings have no JSON-LD or stable selectors —
    # pull straight from the inline GraphQL JSON before the generic waterfall.
    is_facebook_marketplace = (
        _is_facebook_marketplace_url(getattr(page, "url", ""))
        or platform_hint == "facebook-marketplace"
    )
    fb_result = ScrapeResult()
    if is_facebook_marketplace:
        fb_result = await _try_facebook_marketplace(page)
        if fb_result.price is not None:
            if not fb_result.stock_status:
                fb_result.stock_status = "unknown"
            return _normalize_scrape_result(_clear_dealer_price(fb_result))

    result = await _try_json_ld(page)
    if result.price is None:
        result = await _try_microdata(page)
    structured_price_locked = result.price is not None
    smart_data = await _run_smart_scan(page)
    smart = _sanitize_smart_scan_result(_smart_scan_result_from_data(smart_data), smart_data)

    if result.price is None or result.stock_status in (None, "unknown"):
        if result.price is None and smart.price is not None:
            preserved_title = result.title
            result = smart
            result.title = preserved_title or smart.title
        if _should_replace_stock_status(result.stock_status, smart.stock_status):
            result.stock_status = smart.stock_status
        if (
            not is_facebook_marketplace
            and smart.dealer_price is not None
            and result.dealer_price is None
        ):
            result.dealer_price = smart.dealer_price
            result.raw_dealer = smart.raw_dealer
        if smart.discounted_price is not None and result.discounted_price is None:
            result.discounted_price = smart.discounted_price
            result.raw_discounted = smart.raw_discounted

    if result.price is None or result.dealer_price is None or not result.title:
        common = await _try_common(page)
        _merge_price_candidate(result, common)
        if not is_facebook_marketplace and not result.dealer_price and common.dealer_price:
            result.dealer_price = common.dealer_price
            result.raw_dealer = common.raw_dealer
        if not result.title and common.title:
            result.title = common.title
        if _should_replace_stock_status(result.stock_status, common.stock_status):
            result.stock_status = common.stock_status

    if fb_result.title and not result.title:
        result.title = fb_result.title
    if _should_replace_stock_status(result.stock_status, fb_result.stock_status):
        result.stock_status = fb_result.stock_status

    sel = config.selectors
    has_custom = any([
        sel.title, sel.price, sel.discounted_price, sel.dealer_price,
        sel.stock_status,
    ])
    user_locks: set[str] = set()
    if has_custom:
        result, user_locks = await _apply_custom(page, config, result)
    result = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=has_custom,
        structured_price_locked=structured_price_locked,
        user_locks=user_locks,
    )
    if is_facebook_marketplace:
        _clear_dealer_price(result)

    # Phase 2a: replay user-pinned buy-area picks. The user picked specific
    # items in the Selector Lab and told Gabada "track this exact thing as
    # the price / discounted_price / etc." for this product_store. We re-
    # run the buy-area dump and score every saved fingerprint against the
    # current items, then override matching fields. Failed matches leave
    # the waterfall result alone and surface a "site changed" review note.
    if config.buy_area_picks:
        buy_area_dump = await _run_buy_area_dump(page)
        live_items = _coerce_buy_area_items(buy_area_dump.get("items") or [])
        result = _apply_buy_area_picks(result, list(config.buy_area_picks), live_items)

    if not result.stock_status:
        result.stock_status = "unknown"

    return _normalize_scrape_result(result)


# ── Login helper ─────────────────────────────────────────────────────────────

_LOGIN_DONE_BUTTON_SCRIPT = """
(() => {
  const id = "gabada-login-save-button";
  window.__gabadaLoginDone = window.__gabadaLoginDone || false;
  if (document.getElementById(id) || !document.documentElement) return;

  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.textContent = "Save login to Gabada";
  button.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "right:18px",
    "bottom:18px",
    "height:42px",
    "padding:0 16px",
    "border:0",
    "border-radius:999px",
    "background:#0f9f6e",
    "color:white",
    "font:700 13px/42px Arial,sans-serif",
    "box-shadow:0 12px 30px rgba(0,0,0,.22)",
    "cursor:pointer"
  ].join(";");
  button.addEventListener("click", () => {
    window.__gabadaLoginDone = true;
    button.textContent = "Saving to Gabada...";
    button.disabled = true;
    button.style.opacity = "0.8";
    button.style.cursor = "wait";
  });
  document.documentElement.appendChild(button);
})();
"""


def _login_profile_dir(url: str, save_path: str) -> str:
    key = sha1(f"{url}|{save_path}".encode("utf-8")).hexdigest()[:16]
    profile_dir = sessions_dir() / "dealer-browser-profiles" / key
    profile_dir.mkdir(parents=True, exist_ok=True)
    return str(profile_dir)


def _looks_like_login_url(value: str) -> bool:
    return bool(
        re.search(
            r"(login|signin|sign-in|account|customer|dealer|wholesale|auth)",
            value or "",
            re.IGNORECASE,
        )
    )


async def _open_login_context(
    pw: Playwright,
    *,
    url: str,
    save_path: str,
    headless: bool,
) -> BrowserContext:
    options = {
        "user_data_dir": _login_profile_dir(url, save_path),
        "headless": headless,
        "args": [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
        ],
        "ignore_default_args": ["--enable-automation"],
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1280, "height": 900},
        "locale": "en-US",
    }

    if not headless:
        for channel in ("chrome", "msedge"):
            try:
                context = await pw.chromium.launch_persistent_context(
                    channel=channel,
                    **options,
                )
                logger.info("Login window opened with installed %s", channel)
                return context
            except Exception as exc:
                logger.info("Installed %s unavailable for login window: %s", channel, exc)

    logger.info("Login window falling back to bundled Chromium")
    return await pw.chromium.launch_persistent_context(**options)


async def _install_login_done_button(page: Page) -> bool:
    if page.is_closed():
        return False
    try:
        await page.evaluate(_LOGIN_DONE_BUTTON_SCRIPT)
        return bool(await page.evaluate("window.__gabadaLoginDone === true"))
    except Exception:
        return False


async def save_login_state(
    url: str, save_path: str, headless: bool = False, wait_seconds: int = 180
) -> dict:
    """
    Open a browser window, let the user log in manually, then save the
    storage state (cookies + localStorage) to save_path.

    Returns a dict with status + final URL.
    """
    configure_runtime_environment()
    pw = await async_playwright().start()
    context = await _open_login_context(
        pw,
        url=url,
        save_path=save_path,
        headless=headless,
    )
    try:
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        initial_url = page.url
        started_on_login_url = _looks_like_login_url(initial_url)

        logger.info(
            "Login window open at %s. Browser will close in %ds — complete login now.",
            url, wait_seconds,
        )
        logger.info("Click the floating 'Save login to Gabada' button to return early.")
        deadline = asyncio.get_running_loop().time() + max(5, wait_seconds)
        redirected_at: Optional[float] = None
        save_reason = "timeout"

        while asyncio.get_running_loop().time() < deadline:
            if page.is_closed():
                save_reason = "page_closed"
                break

            if await _install_login_done_button(page):
                save_reason = "save_button"
                break

            current_url = page.url
            if (
                started_on_login_url
                and current_url != initial_url
                and not _looks_like_login_url(current_url)
            ):
                now = asyncio.get_running_loop().time()
                if redirected_at is None:
                    redirected_at = now
                elif now - redirected_at >= 4:
                    save_reason = "login_redirect"
                    break
            else:
                redirected_at = None

            await asyncio.sleep(0.5)

        target_path = resolve_storage_state_path(save_path, for_write=True)
        await context.storage_state(path=str(target_path))
        final_url = page.url if not page.is_closed() else url
        logger.info("Login session saved by %s to %s", save_reason, target_path)
        return {"saved_to": str(target_path), "final_url": final_url}
    finally:
        await context.close()
        await pw.stop()

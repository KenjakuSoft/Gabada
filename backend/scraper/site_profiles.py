"""
Per-site scrape profiles loaded from ``sites.toml``.

Lets you register a hostname with a platform hint or custom selectors without
touching engine code. The file lives next to this module and is hot-reloaded
whenever its mtime changes — edit it in Notepad, save, done.

File format (TOML):

    # ``sites.toml``
    ["redacted-store"]
    platform = "cs-cart"

    ["example.com"]
    platform = "generic"
    wait_for = "#product-price"
    [example.com.selectors]
    title = "h1.product-title"
    price = ".price-now"

Matching rules:
    - Exact hostname match wins.
    - ``www.`` is stripped before matching.
    - If no exact hit, walk up the domain suffix:
      ``shop.a.example.com`` → ``a.example.com`` → ``example.com``.
    - Nothing matched → config passes through unchanged.

The merge priority when building the effective ``ScrapeConfig`` is:
    1. Explicit fields set on the incoming config (always win).
    2. Explicit fields from the matched site profile.
    3. Defaults pulled from the profile's ``platform`` (CS-Cart, Shopify, …).
    4. Untouched otherwise (auto-detect still runs at add-product time).
"""
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

if sys.version_info >= (3, 11):
    import tomllib  # type: ignore[import-not-found]
else:  # pragma: no cover - project targets 3.11+
    import tomli as tomllib  # type: ignore[no-redef,import-not-found]

from database.models import ScrapeConfig, ScrapeSelectors

logger = logging.getLogger(__name__)

SITES_TOML_PATH = os.path.join(os.path.dirname(__file__), "sites.toml")


# ── Platform defaults ────────────────────────────────────────────────────────
#
# These used to live in ``engine.py``; moved here so ``site_profiles`` can
# resolve ``platform = "cs-cart"`` etc. without creating an import cycle.

PLATFORM_WAIT_FOR: dict[str, str] = {
    "cs-cart":     ".ty-productPage-price, .ty-price-now, .ty-price-num, .ty-price",
    "woocommerce": ".price .amount",
    "shopify":     ".price, [data-product-price]",
    "magento":     "[data-price-type='finalPrice'] .price, .price-box .price",
    "prestashop":  "#our_price_display, .current-price",
    "generic":     "",
}

PLATFORM_SELECTORS: dict[str, dict[str, Optional[str]]] = {
    "cs-cart": {
        "title": ".ty-product-block-title",
        "price": ".ty-price-retail-price .ty-price-num, .ty-price-retail-price, .ty-list-price .ty-price-num, .ty-list-price",
        "discounted_price": ".ty-productPage-price .ty-price-now, .ty-price-now .ty-price-num, .ty-price-now",
        "dealer_price": ".ty-price-dealer .ty-price-num, .ty-price-dealer",
        "stock_status": ".ty-qty-in-stock, .ty-qty-out-of-stock, .ty-special-msg",
    },
    "woocommerce": {
        "title": ".product_title",
        "price": "div.summary.entry-summary del .amount, .summary.entry-summary del .amount",
        "discounted_price": "div.summary.entry-summary ins .amount, div.summary.entry-summary .price .amount, .summary.entry-summary ins .amount, .summary.entry-summary .price .amount",
        "dealer_price": None,
        "stock_status": ".stock",
    },
    "shopify": {
        "title": ".product__title, h1[class*='product']",
        "price": ".price__compare .price-item, .price-item--regular",
        "discounted_price": ".price-item--sale, .price__regular .price-item",
        "dealer_price": None,
        "stock_status": ".product-form__inventory, [class*='inventory']",
    },
    "magento": {
        "title": ".page-title .base",
        "price": "[data-price-type='oldPrice'] .price",
        "discounted_price": "[data-price-type='finalPrice'] .price, .price-box .price",
        "dealer_price": None,
        "stock_status": ".stock.available, .stock.unavailable",
    },
    "prestashop": {
        "title": ".product_name, h1.product-name",
        "price": ".regular-price",
        "discounted_price": "#our_price_display, .current-price",
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


def apply_platform_defaults(config: ScrapeConfig, platform: str) -> ScrapeConfig:
    """Fill ``wait_for`` and empty selector slots from platform defaults.

    Any field already set on ``config`` is preserved — platform only fills gaps.
    """
    plat = platform if platform in PLATFORM_SELECTORS else "generic"
    defaults = PLATFORM_SELECTORS[plat]
    sel = config.selectors
    merged_selectors = ScrapeSelectors(
        title=sel.title or defaults.get("title"),
        price=sel.price or defaults.get("price"),
        discounted_price=sel.discounted_price or defaults.get("discounted_price"),
        dealer_price=sel.dealer_price or defaults.get("dealer_price"),
        stock_status=sel.stock_status or defaults.get("stock_status"),
        image=sel.image,
    )
    wait_for = config.wait_for or PLATFORM_WAIT_FOR.get(plat) or None
    return ScrapeConfig(
        use_playwright=config.use_playwright,
        wait_for=wait_for,
        wait_timeout=config.wait_timeout,
        selectors=merged_selectors,
        cookies=config.cookies,
        headers=config.headers,
        storage_state_path=config.storage_state_path,
        platform=plat,
    )


# ── Site profile cache ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class SiteProfile:
    hostname: str
    platform: Optional[str] = None
    wait_for: Optional[str] = None
    selectors: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)


_cache: dict[str, dict] = {}
_cache_mtime: float = 0.0


def _load() -> dict[str, dict]:
    """Load and cache the TOML. Re-reads when the file's mtime changes."""
    global _cache, _cache_mtime
    try:
        mtime = os.path.getmtime(SITES_TOML_PATH)
    except OSError:
        _cache = {}
        _cache_mtime = 0.0
        return _cache
    if mtime == _cache_mtime and _cache:
        return _cache
    try:
        with open(SITES_TOML_PATH, "rb") as f:
            raw = tomllib.load(f)
    except Exception as e:
        logger.error("Failed to parse %s: %s", SITES_TOML_PATH, e)
        return _cache
    parsed: dict[str, dict] = {}
    for key, value in raw.items():
        if not isinstance(value, dict):
            continue
        parsed[key.strip().lower()] = value
    _cache = parsed
    _cache_mtime = mtime
    logger.info("Loaded %d site profiles from %s", len(_cache), SITES_TOML_PATH)
    return _cache


def _hostname_candidates(host: str) -> list[str]:
    """``a.b.example.com`` → ``['a.b.example.com', 'b.example.com', 'example.com']``."""
    parts = host.split(".")
    return [".".join(parts[i:]) for i in range(max(0, len(parts) - 1))]


def find_profile(url: str) -> Optional[SiteProfile]:
    profiles = _load()
    if not profiles:
        return None
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return None
    if not host:
        return None
    if host.startswith("www."):
        host = host[4:]
    for candidate in _hostname_candidates(host):
        entry = profiles.get(candidate)
        if not entry:
            continue
        selectors_raw = entry.get("selectors") or {}
        headers_raw = entry.get("headers") or {}
        return SiteProfile(
            hostname=candidate,
            platform=entry.get("platform"),
            wait_for=entry.get("wait_for"),
            selectors={k: str(v) for k, v in selectors_raw.items() if v},
            headers={k: str(v) for k, v in headers_raw.items() if v},
        )
    return None


def apply_profile(url: str, config: ScrapeConfig) -> ScrapeConfig:
    """Merge a matched site profile (and its platform defaults) into config.

    Always safe to call: when no profile matches, the config is returned
    untouched. Explicit fields on ``config`` always win over profile values.
    """
    prof = find_profile(url)
    if not prof:
        return config

    sel = config.selectors
    merged_selectors = ScrapeSelectors(
        title=sel.title or prof.selectors.get("title"),
        price=sel.price or prof.selectors.get("price"),
        discounted_price=sel.discounted_price or prof.selectors.get("discounted_price"),
        dealer_price=sel.dealer_price or prof.selectors.get("dealer_price"),
        stock_status=sel.stock_status or prof.selectors.get("stock_status"),
        image=sel.image or prof.selectors.get("image"),
    )
    # Profile headers augment, but config-level headers win on conflict.
    merged_headers = {**prof.headers, **config.headers}

    merged = ScrapeConfig(
        use_playwright=config.use_playwright,
        wait_for=config.wait_for or prof.wait_for,
        wait_timeout=config.wait_timeout,
        selectors=merged_selectors,
        cookies=config.cookies,
        headers=merged_headers,
        storage_state_path=config.storage_state_path,
        platform=config.platform or prof.platform,
    )
    # Fall through to platform defaults for any slot still empty.
    if prof.platform:
        merged = apply_platform_defaults(merged, prof.platform)
    logger.info("Applied site profile '%s' for %s", prof.hostname, url)
    return merged


# ── File I/O for the editor API ──────────────────────────────────────────────

_DEFAULT_BODY = """# Gabada site profiles
#
# List sites here to pin a platform or override scraping selectors.
# Each table heading is a hostname (no scheme, no path). \"www.\" is stripped
# before matching, so [\"example.com\"] covers both example.com and
# www.example.com. Subdomain matches walk up the domain suffix.
#
# Edit this file with any text editor (Notepad works). Save and the scraper
# reloads automatically — no server restart needed.
#
# Known platforms: cs-cart, woocommerce, shopify, magento, prestashop, generic
#
# Examples:
#
#   [\"redacted-store\"]
#   platform = \"cs-cart\"
#
#   [\"myshop.com\"]
#   platform = \"generic\"
#   wait_for = \"#product-price\"
#   [myshop.com.selectors]
#   title = \"h1.product-title\"
#   price = \".price-now\"
#   stock_status = \".availability\"
"""

_SERIALIZED_HEADER = """# Gabada site profiles
#
# Managed by the Selector Lab and Settings editor.
# Match is by hostname. \"www.\" is stripped automatically.
#
"""


def read_file() -> str:
    try:
        with open(SITES_TOML_PATH, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return _DEFAULT_BODY


def write_file(content: str) -> None:
    """Validate as TOML then overwrite the profiles file and refresh the cache."""
    # Empty string is allowed (wipes all profiles).
    if content.strip():
        tomllib.loads(content)
    os.makedirs(os.path.dirname(SITES_TOML_PATH), exist_ok=True)
    with open(SITES_TOML_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    _load()


def list_hostnames() -> list[str]:
    return sorted(_load().keys())


def normalize_hostname(value: str) -> Optional[str]:
    raw = (value or "").strip()
    if not raw:
        return None
    target = raw if "://" in raw else f"https://{raw.lstrip('/')}"
    try:
        host = (urlparse(target).hostname or "").lower()
    except Exception:
        host = ""
    if not host:
        host = raw.split("/")[0].strip().lower()
    if host.startswith("www."):
        host = host[4:]
    return host or None


def get_exact_profile(hostname: str) -> Optional[SiteProfile]:
    normalized = normalize_hostname(hostname)
    if not normalized:
        return None
    entry = _load().get(normalized)
    if not entry:
        return None
    selectors_raw = entry.get("selectors") or {}
    headers_raw = entry.get("headers") or {}
    return SiteProfile(
        hostname=normalized,
        platform=entry.get("platform"),
        wait_for=entry.get("wait_for"),
        selectors={k: str(v) for k, v in selectors_raw.items() if v},
        headers={k: str(v) for k, v in headers_raw.items() if v},
    )


def _toml_quote(value: str) -> str:
    return json.dumps(value)


def _inline_table(values: dict[str, str]) -> str:
    parts = [
        f"{key} = {_toml_quote(str(values[key]))}"
        for key in sorted(values)
        if values[key]
    ]
    return "{ " + ", ".join(parts) + " }"


def _serialize_profiles(profiles: dict[str, dict]) -> str:
    lines = [_SERIALIZED_HEADER.rstrip(), ""]
    for hostname in sorted(profiles):
        entry = profiles[hostname] or {}
        lines.append(f'["{hostname}"]')
        platform = entry.get("platform")
        wait_for = entry.get("wait_for")
        selectors = {
            str(k): str(v)
            for k, v in (entry.get("selectors") or {}).items()
            if v
        }
        headers = {
            str(k): str(v)
            for k, v in (entry.get("headers") or {}).items()
            if v
        }
        if platform:
            lines.append(f"platform = {_toml_quote(str(platform))}")
        if wait_for:
            lines.append(f"wait_for = {_toml_quote(str(wait_for))}")
        if selectors:
            lines.append(f"selectors = {_inline_table(selectors)}")
        if headers:
            lines.append(f"headers = {_inline_table(headers)}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def upsert_profile(
    hostname: str,
    *,
    platform: Optional[str] = None,
    wait_for: Optional[str] = None,
    selectors: Optional[dict[str, Optional[str]]] = None,
    headers: Optional[dict[str, str]] = None,
) -> SiteProfile:
    normalized = normalize_hostname(hostname)
    if not normalized:
        raise ValueError("Invalid hostname")

    current = {k: dict(v) for k, v in _load().items()}
    selectors_clean = {
        str(k): str(v).strip()
        for k, v in (selectors or {}).items()
        if v and str(v).strip()
    }
    headers_clean = {
        str(k): str(v).strip()
        for k, v in (headers or {}).items()
        if v and str(v).strip()
    }

    entry: dict[str, object] = {}
    if platform:
        entry["platform"] = platform
    if wait_for:
        entry["wait_for"] = wait_for
    if selectors_clean:
        entry["selectors"] = selectors_clean
    if headers_clean:
        entry["headers"] = headers_clean

    if entry:
        current[normalized] = entry
    else:
        current.pop(normalized, None)

    write_file(_serialize_profiles(current))
    profile = get_exact_profile(normalized)
    if profile:
        return profile
    return SiteProfile(hostname=normalized)

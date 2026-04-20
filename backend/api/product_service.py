import logging
import re
from typing import Optional
from urllib.parse import unquote, urlparse

import aiosqlite
from fastapi import HTTPException

from database.models import (
    Product,
    ProductStoreSummary,
    QuickAddResult,
    ScrapeConfig,
    ScrapeSelectors,
)
from scraper.engine import probe as probe_url
from scraper.site_profiles import apply_platform_defaults

logger = logging.getLogger(__name__)

_PRODUCT_QUERY = """
    SELECT p.id, p.canonical_name, p.image_url, p.created_at,
           p.category_id, c.name AS category_name, c.color AS category_color
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
"""

_STORE_SUMMARIES_SELECT = """
    SELECT
        ps.id,
        ps.product_id,
        ps.store_id,
        ps.product_url,
        ps.is_active,
        s.name AS store_name,
        s.base_url AS store_base_url,
        pl.price AS latest_price,
        pl.discounted_price AS latest_discounted_price,
        pl.dealer_price AS latest_dealer_price,
        pl.stock_status AS latest_stock_status,
        pl.scraped_at AS latest_scraped_at,
        pl.change_type AS latest_change_type,
        pl.price_delta AS latest_price_delta,
        pso.manual_price,
        pso.manual_stock_status,
        pso.override_note
    FROM product_stores ps
    JOIN stores s ON s.id = ps.store_id
    LEFT JOIN price_logs pl ON pl.id = (
        SELECT id FROM price_logs
        WHERE product_store_id = ps.id
        ORDER BY scraped_at DESC LIMIT 1
    )
    LEFT JOIN product_store_overrides pso ON pso.product_store_id = ps.id
"""

_SLUG_SEP_RE = re.compile(r"[-_+]+")


def selectors_are_empty(selectors: ScrapeSelectors) -> bool:
    return not any(
        [
            selectors.title,
            selectors.price,
            selectors.discounted_price,
            selectors.dealer_price,
            selectors.stock_status,
            selectors.image,
        ]
    )


async def auto_detect_config(url: str, config: ScrapeConfig) -> ScrapeConfig:
    """Probe a URL and backfill missing scrape defaults without overriding custom values."""
    try:
        report = await probe_url(url, config)
        platform = report.platform or "generic"
        logger.info("Auto-detected platform %s for %s", platform, url)
        return apply_platform_defaults(config, platform)
    except Exception as exc:
        logger.warning("Auto-detect probe failed for %s: %s", url, exc)
        return config


async def create_product_record(
    db: aiosqlite.Connection,
    *,
    canonical_name: str,
    image_url: Optional[str],
    category_id: Optional[int],
) -> int:
    cur = await db.execute(
        "INSERT INTO products (canonical_name, image_url, category_id) VALUES (?, ?, ?)",
        (canonical_name, image_url, category_id),
    )
    return cur.lastrowid


async def create_store_link(
    db: aiosqlite.Connection,
    *,
    product_id: int,
    store_id: int,
    product_url: str,
    scrape_config_json: Optional[str] = None,
) -> int:
    if scrape_config_json is None:
        cur = await db.execute(
            "INSERT INTO product_stores (product_id, store_id, product_url) VALUES (?, ?, ?)",
            (product_id, store_id, product_url),
        )
    else:
        cur = await db.execute(
            """INSERT INTO product_stores (product_id, store_id, product_url, scrape_config)
               VALUES (?, ?, ?, ?)""",
            (product_id, store_id, product_url, scrape_config_json),
        )
    return cur.lastrowid


async def create_product_with_store(
    db: aiosqlite.Connection,
    *,
    canonical_name: str,
    image_url: Optional[str],
    category_id: Optional[int],
    store_id: int,
    product_url: str,
    scrape_config_json: Optional[str] = None,
) -> tuple[int, int]:
    product_id = await create_product_record(
        db,
        canonical_name=canonical_name,
        image_url=image_url,
        category_id=category_id,
    )
    product_store_id = await create_store_link(
        db,
        product_id=product_id,
        store_id=store_id,
        product_url=product_url,
        scrape_config_json=scrape_config_json,
    )
    return product_id, product_store_id


def _row_to_product_store_summary(row: aiosqlite.Row) -> ProductStoreSummary:
    return ProductStoreSummary(
        id=row["id"],
        store_id=row["store_id"],
        store_name=row["store_name"],
        store_base_url=row["store_base_url"],
        product_url=row["product_url"],
        is_active=bool(row["is_active"]),
        latest_price=row["latest_price"],
        latest_discounted_price=row["latest_discounted_price"],
        latest_dealer_price=row["latest_dealer_price"],
        latest_stock_status=row["latest_stock_status"],
        latest_scraped_at=row["latest_scraped_at"],
        latest_change_type=row["latest_change_type"],
        latest_price_delta=row["latest_price_delta"],
        manual_price=row["manual_price"],
        manual_stock_status=row["manual_stock_status"],
        override_note=row["override_note"],
    )


async def get_store_summaries_map(
    db: aiosqlite.Connection,
    product_ids: list[int],
) -> dict[int, list[ProductStoreSummary]]:
    if not product_ids:
        return {}

    placeholders = ", ".join("?" for _ in product_ids)
    rows = await db.execute_fetchall(
        _STORE_SUMMARIES_SELECT
        + f" WHERE ps.product_id IN ({placeholders}) ORDER BY ps.product_id, s.name",
        tuple(product_ids),
    )

    summaries = {product_id: [] for product_id in product_ids}
    for row in rows:
        summaries.setdefault(row["product_id"], []).append(
            _row_to_product_store_summary(row)
        )
    return summaries


async def get_store_summaries(
    db: aiosqlite.Connection, product_id: int
) -> list[ProductStoreSummary]:
    return (await get_store_summaries_map(db, [product_id])).get(product_id, [])


def _row_to_product(row: aiosqlite.Row, stores: list[ProductStoreSummary]) -> Product:
    return Product(
        id=row["id"],
        canonical_name=row["canonical_name"],
        image_url=row["image_url"],
        created_at=row["created_at"],
        category_id=row["category_id"],
        category_name=row["category_name"],
        category_color=row["category_color"],
        stores=stores,
    )


async def fetch_products(
    db: aiosqlite.Connection, category_id: Optional[int] = None
) -> list[Product]:
    if category_id is not None:
        rows = await db.execute_fetchall(
            _PRODUCT_QUERY + " WHERE p.category_id = ? ORDER BY p.canonical_name",
            (category_id,),
        )
    else:
        rows = await db.execute_fetchall(_PRODUCT_QUERY + " ORDER BY p.canonical_name")

    stores_by_product = await get_store_summaries_map(
        db, [row["id"] for row in rows]
    )
    return [
        _row_to_product(row, stores_by_product.get(row["id"], []))
        for row in rows
    ]


async def fetch_product(
    db: aiosqlite.Connection, product_id: int
) -> Optional[Product]:
    rows = await db.execute_fetchall(_PRODUCT_QUERY + " WHERE p.id = ?", (product_id,))
    if not rows:
        return None

    stores = await get_store_summaries(db, product_id)
    return _row_to_product(rows[0], stores)


async def fetch_product_or_404(
    db: aiosqlite.Connection, product_id: int
) -> Product:
    product = await fetch_product(db, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def title_from_url(url: str) -> str:
    """Produce a readable fallback title from the URL's last path segment."""
    try:
        parsed = urlparse(url)
        segments = [segment for segment in parsed.path.split("/") if segment]
        if segments:
            raw = unquote(segments[-1])
            raw = re.sub(r"\.(html?|php|aspx?)$", "", raw, flags=re.IGNORECASE)
            words = _SLUG_SEP_RE.sub(" ", raw).strip()
            if words:
                return words.title()
        return parsed.hostname or url
    except Exception:
        return url


async def find_or_create_store_for_url(
    db: aiosqlite.Connection, url: str
) -> tuple[int, str]:
    """Return the existing store for a URL hostname, creating one when needed."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("URL has no hostname")

    base_url = f"{parsed.scheme or 'https'}://{host}"

    rows = await db.execute_fetchall("SELECT id, name, base_url FROM stores")
    for row in rows:
        try:
            row_host = (urlparse(row["base_url"]).hostname or "").lower()
        except Exception:
            row_host = ""
        if row_host == host:
            return row["id"], row["name"]

    cur = await db.execute(
        "INSERT INTO stores (name, base_url) VALUES (?, ?)",
        (host, base_url),
    )
    await db.commit()
    return cur.lastrowid, host


async def quick_add_one(
    db: aiosqlite.Connection,
    *,
    url: str,
    category_id: Optional[int],
) -> QuickAddResult:
    url = url.strip()
    if not url:
        return QuickAddResult(url=url, status="error", error="Empty URL")

    try:
        store_id, store_name = await find_or_create_store_for_url(db, url)
    except Exception as exc:
        return QuickAddResult(url=url, status="error", error=f"Bad URL: {exc}")

    try:
        report = await probe_url(url, ScrapeConfig())
    except Exception as exc:
        logger.warning("quick-add probe failed for %s: %s", url, exc)
        return QuickAddResult(
            url=url,
            status="error",
            store_id=store_id,
            store_name=store_name,
            error=f"Probe failed: {exc}",
        )

    extracted = report.extracted
    name = (
        (extracted.title or "").strip()
        or (report.json_ld_name or "").strip()
        or title_from_url(url)
    )

    product_id, product_store_id = await create_product_with_store(
        db,
        canonical_name=name,
        image_url=None,
        category_id=category_id,
        store_id=store_id,
        product_url=url,
        scrape_config_json=ScrapeConfig().model_dump_json(),
    )

    if extracted.price is not None or extracted.stock_status != "unknown":
        await db.execute(
            """INSERT INTO price_logs
               (product_store_id, title, price, discounted_price, dealer_price,
                stock_status, raw_price, raw_discounted, raw_dealer,
                change_type, price_delta, previous_price, previous_stock_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, NULL, NULL)""",
            (
                product_store_id,
                extracted.title,
                extracted.price,
                extracted.discounted_price,
                extracted.dealer_price,
                extracted.stock_status,
                extracted.raw_price,
                extracted.raw_discounted,
                extracted.raw_dealer,
            ),
        )

    await db.commit()

    return QuickAddResult(
        url=url,
        status="ok",
        product_id=product_id,
        product_store_id=product_store_id,
        name=name,
        store_id=store_id,
        store_name=store_name,
        platform=report.platform,
        price=extracted.price,
        discounted_price=extracted.discounted_price,
        stock_status=extracted.stock_status,
    )

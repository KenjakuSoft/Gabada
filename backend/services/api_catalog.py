from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional
from urllib.parse import quote, urljoin, urlparse

import httpx
from fastapi import HTTPException

from api.product_service import create_product_with_store, create_store_link
from database.db import get_db
from database.models import (
    ApiImportRequest,
    ApiPreviewRequest,
    ApiProductPreview,
    ApiSyncResult,
    ScrapeConfig,
    ScrapeResult,
    Store,
    neutralize_web_url,
)

logger = logging.getLogger(__name__)

SUPPORTED_API_PLATFORMS = {
    "steam",
    "apple_app_store",
    "apple_store",
    "playstation_store",
    "xbox_store",
    "ea_play",
    "epic_games_store",
    "gog",
    "ubisoft_store",
    "nintendo_store",
    "google_play",
    "custom_json",
}
API_PROVIDER_BASE_URLS = {
    "steam": "https://store.steampowered.com",
    "apple_app_store": "https://itunes.apple.com",
    "apple_store": "https://www.apple.com/store",
    "playstation_store": "https://store.playstation.com",
    "xbox_store": "https://www.xbox.com",
    "ea_play": "https://www.ea.com/ea-play",
    "epic_games_store": "https://store.epicgames.com",
    "gog": "https://www.gog.com",
    "ubisoft_store": "https://store.ubisoft.com",
    "nintendo_store": "https://www.nintendo.com/store",
    "google_play": "https://play.google.com/store",
}
BUILTIN_API_PLATFORMS = {"steam", "apple_app_store", "gog"}
CUSTOM_JSON_CONFIG_PLATFORMS = SUPPORTED_API_PLATFORMS - BUILTIN_API_PLATFORMS

_API_TIMEOUT = httpx.Timeout(45.0, connect=15.0)
_STEAM_TIMEOUT = _API_TIMEOUT
_STEAM_SEARCH_LIMIT = 100
_STEAM_APP_RE = re.compile(r"(?:^|/app/|app/)(\d{2,})(?:/|$|\?)")
_APPLE_APP_RE = re.compile(r"(?:^|/id)(\d{4,})(?:[/?#]|$)")
_GOG_GAME_RE = re.compile(r"(?:^|/game/)([a-z0-9][a-z0-9_\-]*)(?:[/?#]|$)")
_LANGUAGE_ALIASES = {
    "en": "english",
}


def normalize_api_platform(platform: str | None) -> str:
    value = (platform or "").strip().lower()
    if not value:
        raise HTTPException(status_code=400, detail="API platform is required")
    if value not in SUPPORTED_API_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Unsupported API platform: {platform}")
    return value


def api_provider_base_url(platform: str | None) -> str | None:
    value = (platform or "").strip().lower()
    return API_PROVIDER_BASE_URLS.get(value)


def steam_app_id_from_value(value: str | int | None) -> Optional[int]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)

    parsed = urlparse(text)
    match = re.search(r"/app/(\d+)(?:/|$)", parsed.path)
    if match:
        return int(match.group(1))

    match = _STEAM_APP_RE.search(text)
    if match:
        return int(match.group(1))
    return None


def apple_app_id_from_value(value: str | int | None) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return text

    parsed = urlparse(text)
    match = re.search(r"/id(\d+)(?:[/?#]|$)", parsed.path)
    if match:
        return match.group(1)
    query_match = re.search(r"(?:^|[?&])id=(\d+)(?:&|$)", parsed.query)
    if query_match:
        return query_match.group(1)
    match = _APPLE_APP_RE.search(text)
    if match:
        return match.group(1)
    return None


def gog_slug_from_value(value: str | int | None) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    parsed = urlparse(text)
    match = re.search(r"/game/([a-z0-9][a-z0-9_\-]*)(?:/|$)", parsed.path.lower())
    if match:
        return match.group(1)

    match = _GOG_GAME_RE.search(text.lower())
    if match:
        return match.group(1)

    if re.fullmatch(r"[a-z0-9][a-z0-9_\-]*", text.lower()):
        return text.lower()
    return None


def _normalize_country_code(country_code: str | None) -> str:
    value = re.sub(r"[^a-z]", "", (country_code or "").strip().lower()).upper()
    return value[:2] or "US"


def _normalize_steam_language(language: str | None) -> str:
    value = (language or "").strip().lower() or "english"
    return _LANGUAGE_ALIASES.get(value, value)


def _normalize_apple_language(language: str | None) -> str:
    value = (language or "").strip().lower().replace("-", "_")
    if value in ("", "english", "en"):
        return "en_us"
    if len(value) == 2:
        return f"{value}_{value}"
    return value


def _dedupe_app_ids(values: list[str | int | None]) -> list[int]:
    app_ids: list[int] = []
    seen: set[int] = set()
    for value in values:
        app_id = steam_app_id_from_value(value)
        if app_id is None or app_id in seen:
            continue
        app_ids.append(app_id)
        seen.add(app_id)
    return app_ids


def _dedupe_apple_app_ids(values: list[str | int | None]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for value in values:
        app_id = apple_app_id_from_value(value)
        if app_id is None or app_id in seen:
            continue
        ids.append(app_id)
        seen.add(app_id)
    return ids


def _dedupe_gog_slugs(values: list[str | int | None]) -> list[str]:
    slugs: list[str] = []
    seen: set[str] = set()
    for value in values:
        slug = gog_slug_from_value(value)
        if slug is None or slug in seen:
            continue
        slugs.append(slug)
        seen.add(slug)
    return slugs


def _dedupe_external_ids(platform: str, values: list[str | int | None]) -> list[str]:
    if platform == "steam":
        return [str(value) for value in _dedupe_app_ids(values)]
    if platform == "apple_app_store":
        return _dedupe_apple_app_ids(values)
    if platform == "gog":
        return _dedupe_gog_slugs(values)

    ids: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        ids.append(text)
        seen.add(text)
    return ids


def _chunked(values: list[int], size: int) -> list[list[int]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _money_from_steam_cents(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return round(float(value) / 100, 2)
    except (TypeError, ValueError):
        return None


def _formatted_money(currency: Optional[str], value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    if currency:
        return f"{currency} {value:,.2f}"
    return f"{value:,.2f}"


def _number_from_value(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return round(float(value), 2)

    text = str(value).strip()
    if not text:
        return None
    if text.lower() in {"free", "gratis"}:
        return 0.0
    cleaned = re.sub(r"[^0-9,.\-]", "", text)
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(",", "")
    elif "," in cleaned and "." not in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def _steam_price_fields(source: dict[str, Any]) -> dict[str, Any]:
    price_overview = source.get("price_overview") or source.get("price") or {}
    is_free = bool(source.get("is_free"))
    currency = price_overview.get("currency")

    if is_free and not price_overview:
        return {
            "price": 0.0,
            "discounted_price": None,
            "currency": currency,
            "raw_price": "Free",
            "raw_discounted": None,
        }

    initial = _money_from_steam_cents(price_overview.get("initial"))
    final = _money_from_steam_cents(price_overview.get("final"))
    discount_percent = int(price_overview.get("discount_percent") or 0)

    if initial is None and final is None:
        return {
            "price": None,
            "discounted_price": None,
            "currency": currency,
            "raw_price": None,
            "raw_discounted": None,
        }

    if initial is None:
        initial = final
    if final is None:
        final = initial

    raw_initial = (
        price_overview.get("initial_formatted")
        or price_overview.get("initialFormatted")
        or _formatted_money(currency, initial)
    )
    raw_final = (
        price_overview.get("final_formatted")
        or price_overview.get("finalFormatted")
        or _formatted_money(currency, final)
    )

    if discount_percent > 0 and initial is not None and final is not None and final < initial:
        return {
            "price": initial,
            "discounted_price": final,
            "currency": currency,
            "raw_price": raw_initial,
            "raw_discounted": raw_final,
        }

    return {
        "price": final if final is not None else initial,
        "discounted_price": None,
        "currency": currency,
        "raw_price": raw_final or raw_initial,
        "raw_discounted": None,
    }


def _steam_stock_status(data: dict[str, Any]) -> str:
    release_date = data.get("release_date") or {}
    if release_date.get("coming_soon"):
        return "preorder"
    return "in_stock"


def _steam_preview_from_detail(app_id: int, payload: dict[str, Any]) -> Optional[ApiProductPreview]:
    if payload.get("success") is False:
        return None
    data = payload.get("data") if "data" in payload else payload
    if not isinstance(data, dict):
        return None
    name = (data.get("name") or "").strip()
    if not name:
        return None

    price = _steam_price_fields(data)
    genres = data.get("genres") or []
    categories = [
        str(item.get("description"))
        for item in genres
        if isinstance(item, dict) and item.get("description")
    ]
    return ApiProductPreview(
        platform="steam",
        external_id=str(app_id),
        name=name,
        permalink=f"{API_PROVIDER_BASE_URLS['steam']}/app/{app_id}/",
        price=price["price"],
        discounted_price=price["discounted_price"],
        currency=price["currency"],
        raw_price=price["raw_price"],
        raw_discounted=price["raw_discounted"],
        stock_status=_steam_stock_status(data),
        image_url=data.get("header_image") or data.get("capsule_image"),
        categories=categories,
    )


def _steam_preview_from_search_item(item: dict[str, Any]) -> Optional[ApiProductPreview]:
    app_id = steam_app_id_from_value(item.get("id") or item.get("appid"))
    name = (item.get("name") or "").strip()
    if app_id is None or not name:
        return None
    price = _steam_price_fields(item)
    return ApiProductPreview(
        platform="steam",
        external_id=str(app_id),
        name=name,
        permalink=f"{API_PROVIDER_BASE_URLS['steam']}/app/{app_id}/",
        price=price["price"],
        discounted_price=price["discounted_price"],
        currency=price["currency"],
        raw_price=price["raw_price"],
        raw_discounted=price["raw_discounted"],
        stock_status="in_stock",
        image_url=item.get("tiny_image"),
        categories=[],
    )


async def _steam_fetch_details(
    app_ids: list[int],
    *,
    country_code: str,
    language: str,
) -> list[ApiProductPreview]:
    if not app_ids:
        return []

    previews_by_id: dict[int, ApiProductPreview] = {}
    async with httpx.AsyncClient(timeout=_STEAM_TIMEOUT) as client:
        for chunk in _chunked(app_ids, 50):
            try:
                resp = await client.get(
                    f"{API_PROVIDER_BASE_URLS['steam']}/api/appdetails",
                    params={
                        "appids": ",".join(str(app_id) for app_id in chunk),
                        "cc": country_code,
                        "l": language,
                    },
                )
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Cannot reach Steam API: {exc}") from exc

            if resp.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Steam appdetails failed with HTTP {resp.status_code}",
                )

            try:
                payload = resp.json()
            except ValueError as exc:
                raise HTTPException(status_code=502, detail="Steam appdetails returned invalid JSON") from exc

            for app_id in chunk:
                item_payload = payload.get(str(app_id)) if isinstance(payload, dict) else None
                if not isinstance(item_payload, dict):
                    continue
                preview = _steam_preview_from_detail(app_id, item_payload)
                if preview is not None:
                    previews_by_id[app_id] = preview

    return [previews_by_id[app_id] for app_id in app_ids if app_id in previews_by_id]


async def _steam_search(
    query: str,
    *,
    country_code: str,
    language: str,
    limit: int,
) -> list[ApiProductPreview]:
    term = (query or "").strip()
    if not term:
        raise HTTPException(status_code=400, detail="Search term or Steam app IDs are required")

    query_app_id = steam_app_id_from_value(term)
    if query_app_id is not None:
        return await _steam_fetch_details(
            [query_app_id],
            country_code=country_code,
            language=language,
        )

    async with httpx.AsyncClient(timeout=_STEAM_TIMEOUT) as client:
        try:
            resp = await client.get(
                f"{API_PROVIDER_BASE_URLS['steam']}/api/storesearch/",
                params={
                    "term": term,
                    "cc": country_code,
                    "l": language,
                    "category1": 998,
                },
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach Steam search: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Steam search failed with HTTP {resp.status_code}",
        )
    try:
        payload = resp.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Steam search returned invalid JSON") from exc

    raw_items_value = payload.get("items") if isinstance(payload, dict) else []
    raw_items = raw_items_value if isinstance(raw_items_value, list) else []
    search_previews = [
        preview
        for item in raw_items[:limit]
        if isinstance(item, dict)
        for preview in [_steam_preview_from_search_item(item)]
        if preview is not None
    ]
    detail_previews = await _steam_fetch_details(
        [int(item.external_id) for item in search_previews],
        country_code=country_code,
        language=language,
    )
    if not detail_previews:
        return search_previews

    detail_by_id = {item.external_id: item for item in detail_previews}
    return [detail_by_id.get(item.external_id, item) for item in search_previews]


def _apple_preview_from_item(item: dict[str, Any]) -> Optional[ApiProductPreview]:
    app_id = apple_app_id_from_value(item.get("trackId") or item.get("collectionId"))
    name = (item.get("trackName") or item.get("collectionName") or "").strip()
    if not app_id or not name:
        return None

    currency = item.get("currency")
    price = _number_from_value(item.get("price") if "price" in item else item.get("trackPrice"))
    raw_price = item.get("formattedPrice") or _formatted_money(currency, price)
    categories = []
    genres = item.get("genres")
    if isinstance(genres, list):
        categories.extend(str(value).strip() for value in genres if str(value).strip())
    primary_genre = str(item.get("primaryGenreName") or "").strip()
    if primary_genre and primary_genre not in categories:
        categories.append(primary_genre)

    return ApiProductPreview(
        platform="apple_app_store",
        external_id=app_id,
        name=name,
        permalink=item.get("trackViewUrl") or f"https://apps.apple.com/app/id{app_id}",
        price=price,
        discounted_price=None,
        currency=str(currency).upper() if currency else None,
        raw_price=raw_price,
        raw_discounted=None,
        stock_status="in_stock",
        image_url=item.get("artworkUrl512") or item.get("artworkUrl100") or item.get("artworkUrl60"),
        categories=categories,
    )


async def _apple_fetch_lookup(
    app_ids: list[str],
    *,
    country_code: str,
    language: str,
) -> list[ApiProductPreview]:
    if not app_ids:
        return []

    previews_by_id: dict[str, ApiProductPreview] = {}
    async with httpx.AsyncClient(timeout=_API_TIMEOUT) as client:
        for chunk in [app_ids[index : index + 100] for index in range(0, len(app_ids), 100)]:
            try:
                resp = await client.get(
                    f"{API_PROVIDER_BASE_URLS['apple_app_store']}/lookup",
                    params={
                        "id": ",".join(chunk),
                        "country": country_code,
                        "entity": "software",
                        "lang": language,
                    },
                )
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Cannot reach Apple App Store API: {exc}") from exc

            if resp.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Apple App Store lookup failed with HTTP {resp.status_code}",
                )
            try:
                payload = resp.json()
            except ValueError as exc:
                raise HTTPException(status_code=502, detail="Apple App Store lookup returned invalid JSON") from exc

            raw_results = payload.get("results") if isinstance(payload, dict) else []
            if not isinstance(raw_results, list):
                continue
            for raw_item in raw_results:
                if not isinstance(raw_item, dict):
                    continue
                preview = _apple_preview_from_item(raw_item)
                if preview is not None:
                    previews_by_id[preview.external_id] = preview

    return [previews_by_id[app_id] for app_id in app_ids if app_id in previews_by_id]


async def _apple_search(
    query: str,
    *,
    country_code: str,
    language: str,
    limit: int,
) -> list[ApiProductPreview]:
    term = (query or "").strip()
    if not term:
        raise HTTPException(status_code=400, detail="Search term or Apple app IDs are required")

    query_app_id = apple_app_id_from_value(term)
    if query_app_id is not None:
        return await _apple_fetch_lookup(
            [query_app_id],
            country_code=country_code,
            language=language,
        )

    async with httpx.AsyncClient(timeout=_API_TIMEOUT) as client:
        try:
            resp = await client.get(
                f"{API_PROVIDER_BASE_URLS['apple_app_store']}/search",
                params={
                    "term": term,
                    "country": country_code,
                    "media": "software",
                    "entity": "software",
                    "limit": limit,
                    "lang": language,
                },
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach Apple App Store search: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Apple App Store search failed with HTTP {resp.status_code}",
        )
    try:
        payload = resp.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Apple App Store search returned invalid JSON") from exc

    raw_items = payload.get("results") if isinstance(payload, dict) else []
    if not isinstance(raw_items, list):
        return []
    previews = []
    for item in raw_items[:limit]:
        if not isinstance(item, dict):
            continue
        preview = _apple_preview_from_item(item)
        if preview is not None:
            previews.append(preview)
    return previews


def _protocol_url(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    if text.startswith("//"):
        return f"https:{text}"
    return text


def _extract_balanced_json_object(text: str, marker: str) -> Optional[dict[str, Any]]:
    marker_index = text.find(marker)
    if marker_index < 0:
        return None
    start = marker_index + len(marker)
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] != "{":
        return None

    level = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            level += 1
        elif char == "}":
            level -= 1
            if level == 0:
                try:
                    parsed = json.loads(text[start : index + 1])
                except ValueError:
                    return None
                return parsed if isinstance(parsed, dict) else None
    return None


def _regex_group(text: str, pattern: str) -> Optional[str]:
    match = re.search(pattern, text, re.S)
    if not match:
        return None
    return match.group(1)


def _gog_money_fields(product: dict[str, Any], currency: Optional[str], symbol: Optional[str]) -> dict[str, Any]:
    price_data = product.get("price")
    if not isinstance(price_data, dict):
        return {
            "price": None,
            "discounted_price": None,
            "raw_price": None,
            "raw_discounted": None,
        }

    final = 0.0 if price_data.get("isFree") else _number_from_value(price_data.get("finalAmount"))
    base = 0.0 if price_data.get("isFree") else _number_from_value(price_data.get("baseAmount"))
    discount_percent = _number_from_value(price_data.get("discountPercentage")) or 0
    if base is None:
        base = final
    if final is None:
        final = base

    def raw(value: Optional[float]) -> Optional[str]:
        if value is None:
            return None
        if value == 0:
            return "Free"
        if symbol:
            return f"{symbol}{value:,.2f}"
        return _formatted_money(currency, value)

    if (
        discount_percent > 0
        and base is not None
        and final is not None
        and final < base
    ):
        return {
            "price": base,
            "discounted_price": final,
            "raw_price": raw(base),
            "raw_discounted": raw(final),
        }
    return {
        "price": final if final is not None else base,
        "discounted_price": None,
        "raw_price": raw(final if final is not None else base),
        "raw_discounted": None,
    }


def _gog_stock_status(product: dict[str, Any]) -> str:
    if product.get("isComingSoon") or product.get("isAvailabilityPreorder") or product.get("isPreorder"):
        return "preorder"
    if product.get("isAvailabilityOutOfStock") or product.get("isAvailableForSale") is False:
        return "out_of_stock"
    if product.get("isAvailabilityInStock") or product.get("isAvailableForSale"):
        return "in_stock"
    return "unknown"


def _gog_preview_from_card_product(
    product: dict[str, Any],
    *,
    currency: Optional[str],
    symbol: Optional[str],
) -> Optional[ApiProductPreview]:
    title = str(product.get("title") or "").strip()
    slug = gog_slug_from_value(product.get("url")) or gog_slug_from_value(product.get("slug"))
    if not title or not slug:
        return None

    price = _gog_money_fields(product, currency, symbol)
    categories: list[str] = []
    for key in ("genres", "gameTags", "tags"):
        values = product.get(key)
        if not isinstance(values, list):
            continue
        for item in values:
            text = item.get("name") if isinstance(item, dict) else item
            if str(text or "").strip() and str(text).strip() not in categories:
                categories.append(str(text).strip())

    image_url = (
        _protocol_url(product.get("image"))
        or _protocol_url(product.get("boxArtImage"))
        or _protocol_url(product.get("backgroundImage"))
        or _protocol_url(product.get("galaxyBackgroundImage"))
    )
    return ApiProductPreview(
        platform="gog",
        external_id=slug,
        name=title,
        permalink=f"{API_PROVIDER_BASE_URLS['gog']}/en/game/{slug}",
        price=price["price"],
        discounted_price=price["discounted_price"],
        currency=currency,
        raw_price=price["raw_price"],
        raw_discounted=price["raw_discounted"],
        stock_status=_gog_stock_status(product),
        image_url=image_url,
        categories=categories,
    )


async def _gog_fetch_product_page(slug: str) -> Optional[ApiProductPreview]:
    url = f"{API_PROVIDER_BASE_URLS['gog']}/en/game/{slug}"
    async with httpx.AsyncClient(timeout=_API_TIMEOUT, follow_redirects=True) as client:
        try:
            resp = await client.get(
                url,
                headers={
                    "Accept": "text/html,application/xhtml+xml",
                    "User-Agent": "Gabada/1.0 (+https://github.com)",
                },
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach GOG product page: {exc}") from exc

    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"GOG product page failed with HTTP {resp.status_code}",
        )

    product = _extract_balanced_json_object(resp.text, "cardProduct:")
    if product is None:
        return None
    suffix = resp.text[resp.text.find("cardProduct:") :]
    currency = _regex_group(suffix, r'currency:\s*"([A-Z]{3})"')
    symbol = _regex_group(suffix, r'currencySymbol:\s*"([^"]+)"')
    return _gog_preview_from_card_product(product, currency=currency, symbol=symbol)


async def _gog_fetch_by_slugs(slugs: list[str]) -> list[ApiProductPreview]:
    previews: list[ApiProductPreview] = []
    for slug in slugs:
        preview = await _gog_fetch_product_page(slug)
        if preview is not None:
            previews.append(preview)
    return previews


async def _gog_search(
    query: str,
    *,
    external_ids: list[str],
) -> list[ApiProductPreview]:
    slugs = _dedupe_gog_slugs([*external_ids, query])
    if not slugs:
        raise HTTPException(status_code=400, detail="Paste a GOG product URL or slug")
    return await _gog_fetch_by_slugs(slugs)


def _custom_provider_config(raw_config: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(raw_config, dict):
        return {}
    custom = raw_config.get("custom_json")
    if isinstance(custom, dict):
        merged = {key: value for key, value in raw_config.items() if key != "custom_json"}
        merged.update(custom)
        return merged
    return dict(raw_config)


def _custom_mapping(config: dict[str, Any]) -> dict[str, Any]:
    mapping = config.get("mapping")
    return mapping if isinstance(mapping, dict) else {}


def _path_options(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").strip()
    if not text:
        return []
    return [part.strip() for part in re.split(r"\s*\|\|\s*", text) if part.strip()]


def _json_path(source: Any, path: str) -> Any:
    if not path:
        return source
    value = source
    for token in re.sub(r"\[(\d+)\]", r".\1", path).split("."):
        token = token.strip()
        if not token:
            continue
        if isinstance(value, dict):
            value = value.get(token)
        elif isinstance(value, list) and token.isdigit():
            index = int(token)
            value = value[index] if 0 <= index < len(value) else None
        else:
            return None
        if value is None:
            return None
    return value


def _json_value(source: Any, paths: Any) -> Any:
    for path in _path_options(paths):
        value = _json_path(source, path)
        if value not in (None, ""):
            return value
    return None


def _custom_field_path(config: dict[str, Any], key: str, default: str) -> Any:
    mapping = _custom_mapping(config)
    short_key = key.removesuffix("_path")
    return mapping.get(short_key) or mapping.get(key) or config.get(key) or default


def _string_or_none(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    return str(value).strip() or None


def _custom_stock_status(value: Any) -> str:
    if isinstance(value, bool):
        return "in_stock" if value else "out_of_stock"
    text = str(value or "").strip().lower()
    if not text:
        return "unknown"
    compact = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    if compact in {"in_stock", "instock", "available", "yes", "true", "active"}:
        return "in_stock"
    if compact in {"out_of_stock", "outofstock", "sold_out", "unavailable", "false", "no"}:
        return "out_of_stock"
    if "preorder" in compact or "pre_order" in compact:
        return "preorder"
    if "backorder" in compact or "back_order" in compact:
        return "backorder"
    if "limited" in compact:
        return "limited"
    if "discontinued" in compact:
        return "discontinued"
    return compact if compact in {"in_stock", "out_of_stock", "limited", "preorder", "backorder"} else "unknown"


def _custom_categories(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        categories: list[str] = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("name") or item.get("title") or item.get("label")
            else:
                text = item
            if str(text or "").strip():
                categories.append(str(text).strip())
        return categories
    return [part.strip() for part in re.split(r"[,;/]", str(value)) if part.strip()]


def _render_custom_template(
    template: str,
    *,
    query: str,
    external_id: str | None,
    external_ids: list[str],
    country_code: str,
    language: str,
    api_key: str | None,
) -> str:
    ids = ",".join(external_ids)
    replacements = {
        "query": query,
        "id": external_id or "",
        "external_id": external_id or "",
        "ids": ids,
        "external_ids": ids,
        "country": country_code,
        "country_lower": country_code.lower(),
        "language": language,
        "language_lower": language.lower(),
        "api_key": api_key or "",
    }
    rendered = template
    for key, value in replacements.items():
        rendered = rendered.replace(f"{{{key}}}", quote(str(value), safe=""))
    return rendered


def _custom_headers(config: dict[str, Any], api_key: str | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    raw_headers = config.get("headers")
    if isinstance(raw_headers, dict):
        headers.update({str(key): str(value) for key, value in raw_headers.items()})
    headers_json = str(config.get("headers_json") or "").strip()
    if headers_json:
        try:
            parsed = json.loads(headers_json)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            headers.update({str(key): str(value) for key, value in parsed.items()})

    if api_key:
        header_name = str(config.get("api_key_header") or "").strip()
        if header_name:
            prefix = str(config.get("api_key_prefix") or "").strip()
            headers[header_name] = f"{prefix} {api_key}".strip()
    return headers


def _custom_result_items(payload: Any, config: dict[str, Any]) -> list[Any]:
    result_path = (
        config.get("results_path")
        or config.get("items_path")
        or config.get("data_path")
        or ""
    )
    if result_path:
        value = _json_path(payload, str(result_path))
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return [value]
        return []

    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("results", "items", "products", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                for nested_key in ("results", "items", "products"):
                    nested = value.get(nested_key)
                    if isinstance(nested, list):
                        return nested
                return [value]
        return [payload]
    return []


def _custom_preview_from_item(
    platform: str,
    item: Any,
    *,
    config: dict[str, Any],
    base_url: str | None,
) -> Optional[ApiProductPreview]:
    if not isinstance(item, dict):
        return None

    external_id = _string_or_none(_json_value(item, _custom_field_path(config, "external_id_path", "id")))
    name = _string_or_none(_json_value(item, _custom_field_path(config, "name_path", "name")))
    if not external_id or not name:
        return None

    currency = _string_or_none(_json_value(item, _custom_field_path(config, "currency_path", "currency")))
    price_source = _json_value(item, _custom_field_path(config, "price_path", "price"))
    discounted_source = _json_value(
        item,
        _custom_field_path(config, "discounted_price_path", "discounted_price||sale_price"),
    )
    price = _number_from_value(price_source)
    discounted_price = _number_from_value(discounted_source)
    raw_price = _string_or_none(
        _json_value(item, _custom_field_path(config, "raw_price_path", "raw_price"))
    ) or _string_or_none(price_source) or _formatted_money(currency, price)
    raw_discounted = _string_or_none(
        _json_value(item, _custom_field_path(config, "raw_discounted_path", "raw_discounted"))
    ) or _string_or_none(discounted_source) or _formatted_money(currency, discounted_price)

    if price is None and discounted_price is not None:
        price = discounted_price
        raw_price = raw_discounted
        discounted_price = None
        raw_discounted = None
    if (
        price is not None
        and discounted_price is not None
        and discounted_price >= price
    ):
        discounted_price = None
        raw_discounted = None

    permalink = _string_or_none(_json_value(item, _custom_field_path(config, "url_path", "url||permalink")))
    if permalink and base_url and not urlparse(permalink).scheme:
        permalink = urljoin(base_url.rstrip("/") + "/", permalink.lstrip("/"))
    if not permalink:
        permalink = f"{(base_url or API_PROVIDER_BASE_URLS.get(platform) or 'api://catalog').rstrip('/')}/{external_id}"

    image_url = _string_or_none(
        _json_value(item, _custom_field_path(config, "image_path", "image_url||image||thumbnail"))
    )
    if image_url and base_url and not urlparse(image_url).scheme:
        image_url = urljoin(base_url.rstrip("/") + "/", image_url.lstrip("/"))

    stock_value = _json_value(item, _custom_field_path(config, "stock_path", "stock_status||availability||available"))
    categories_value = _json_value(item, _custom_field_path(config, "categories_path", "categories||genres"))

    return ApiProductPreview(
        platform=platform,
        external_id=external_id,
        name=name,
        permalink=permalink,
        price=price,
        discounted_price=discounted_price,
        currency=currency.upper() if currency else None,
        raw_price=raw_price,
        raw_discounted=raw_discounted,
        stock_status=_custom_stock_status(stock_value),
        image_url=image_url,
        categories=_custom_categories(categories_value),
    )


async def _custom_json_fetch(
    *,
    platform: str,
    template: str,
    query: str,
    external_id: str | None,
    external_ids: list[str],
    country_code: str,
    language: str,
    base_url: str | None,
    api_key: str | None,
    config: dict[str, Any],
) -> list[ApiProductPreview]:
    rendered = _render_custom_template(
        template,
        query=query,
        external_id=external_id,
        external_ids=external_ids,
        country_code=country_code,
        language=language,
        api_key=api_key,
    )
    url = rendered
    if base_url and not urlparse(url).scheme:
        url = urljoin(base_url.rstrip("/") + "/", url.lstrip("/"))
    if not urlparse(url).scheme:
        raise HTTPException(status_code=400, detail="Custom API URL must be absolute or have a base URL")

    async with httpx.AsyncClient(timeout=_API_TIMEOUT) as client:
        try:
            resp = await client.get(url, headers=_custom_headers(config, api_key))
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach custom API catalog: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Custom API catalog failed with HTTP {resp.status_code}",
        )
    try:
        payload = resp.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Custom API catalog returned invalid JSON") from exc

    previews = []
    for raw_item in _custom_result_items(payload, config):
        preview = _custom_preview_from_item(
            platform,
            raw_item,
            config=config,
            base_url=base_url,
        )
        if preview is not None:
            previews.append(preview)
    return previews


async def _custom_json_catalog(
    platform: str,
    body: ApiPreviewRequest,
    *,
    country_code: str,
    language: str,
    limit: int,
) -> list[ApiProductPreview]:
    config = _custom_provider_config(body.config)
    search_template = str(
        config.get("url_template")
        or config.get("search_url_template")
        or config.get("endpoint")
        or ""
    ).strip()
    detail_template = str(config.get("detail_url_template") or "").strip()
    if not search_template and not detail_template:
        raise HTTPException(
            status_code=400,
            detail="This API platform needs a JSON catalog URL template in the store API config.",
        )

    external_ids = _dedupe_external_ids(platform, body.external_ids)
    query = (body.query or "").strip()
    base_url = str(body.base_url or config.get("base_url") or api_provider_base_url(platform) or "").strip() or None
    api_key = str(body.api_key or config.get("api_key") or "").strip() or None

    if external_ids and detail_template:
        previews_by_id: dict[str, ApiProductPreview] = {}
        for external_id in external_ids:
            for preview in await _custom_json_fetch(
                platform=platform,
                template=detail_template,
                query=query or external_id,
                external_id=external_id,
                external_ids=[external_id],
                country_code=country_code,
                language=language,
                base_url=base_url,
                api_key=api_key,
                config=config,
            ):
                previews_by_id[preview.external_id] = preview
        return [previews_by_id[external_id] for external_id in external_ids if external_id in previews_by_id]

    template = search_template or detail_template
    if not query and external_ids:
        query = ",".join(external_ids)
    if not query and not external_ids:
        raise HTTPException(status_code=400, detail="Search term or API product IDs are required")

    previews = await _custom_json_fetch(
        platform=platform,
        template=template,
        query=query,
        external_id=external_ids[0] if external_ids else None,
        external_ids=external_ids,
        country_code=country_code,
        language=language,
        base_url=base_url,
        api_key=api_key,
        config=config,
    )
    if external_ids:
        wanted = set(external_ids)
        previews = [preview for preview in previews if preview.external_id in wanted]
    return previews[:limit]


async def fetch_api_preview_products(body: ApiPreviewRequest) -> list[ApiProductPreview]:
    platform = normalize_api_platform(body.platform)
    country_code = _normalize_country_code(body.country_code)
    language = _normalize_steam_language(body.language)
    limit = max(1, min(int(body.limit or 25), _STEAM_SEARCH_LIMIT))

    if platform == "steam":
        app_ids = _dedupe_app_ids(body.external_ids)
        if app_ids:
            return await _steam_fetch_details(
                app_ids,
                country_code=country_code,
                language=language,
            )
        return await _steam_search(
            body.query or "",
            country_code=country_code,
            language=language,
            limit=limit,
        )

    if platform == "apple_app_store":
        apple_language = _normalize_apple_language(body.language)
        app_ids = _dedupe_apple_app_ids(body.external_ids)
        if app_ids:
            return await _apple_fetch_lookup(
                app_ids,
                country_code=country_code,
                language=apple_language,
            )
        return await _apple_search(
            body.query or "",
            country_code=country_code,
            language=apple_language,
            limit=limit,
        )

    if platform == "gog":
        return await _gog_search(
            body.query or "",
            external_ids=body.external_ids,
        )

    return await _custom_json_catalog(
        platform,
        body,
        country_code=country_code,
        language=language,
        limit=limit,
    )


def _normalize_store_product_url(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    path = parsed.path.rstrip("/")
    return parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        path=path,
        fragment="",
    ).geturl()


def _normalize_store_product_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def _loads_api_config(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _row_to_store(row) -> Store:
    return Store(
        id=row["id"],
        name=row["name"],
        base_url=row["base_url"],
        manual_only=bool(row["manual_only"]),
        login_url=row["login_url"],
        storage_state_path=row["storage_state_path"],
        session_updated_at=row["session_updated_at"],
        woo_enabled=bool(row["woo_enabled"]),
        woo_site_url=row["woo_site_url"],
        woo_consumer_key=row["woo_consumer_key"],
        woo_consumer_secret=row["woo_consumer_secret"],
        woo_auto_import_new=bool(row["woo_auto_import_new"]),
        woo_last_synced_at=row["woo_last_synced_at"],
        api_enabled=bool(row["api_enabled"]),
        api_platform=row["api_platform"],
        api_base_url=row["api_base_url"],
        api_key=row["api_key"],
        api_config=_loads_api_config(row["api_config"]),
        api_auto_import_new=bool(row["api_auto_import_new"]),
        api_last_synced_at=row["api_last_synced_at"],
        created_at=row["created_at"],
    )


async def _get_store_or_404(db, store_id: int) -> Store:
    rows = await db.execute_fetchall(
        """SELECT
               id,
               name,
               base_url,
               manual_only,
               login_url,
               storage_state_path,
               session_updated_at,
               woo_enabled,
               woo_site_url,
               woo_consumer_key,
               woo_consumer_secret,
               woo_auto_import_new,
               woo_last_synced_at,
               api_enabled,
               api_platform,
               api_base_url,
               api_key,
               api_config,
               api_auto_import_new,
               api_last_synced_at,
               created_at
           FROM stores
           WHERE id = ?""",
        (store_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Store not found")
    return _row_to_store(rows[0])


async def _existing_store_product_maps(db, store_id: int) -> tuple[dict[str, dict], dict[str, dict]]:
    rows = await db.execute_fetchall(
        """SELECT
               p.id AS product_id,
               p.canonical_name,
               p.image_url,
               ps.id AS product_store_id,
               ps.product_url
           FROM product_stores ps
           JOIN products p ON p.id = ps.product_id
           WHERE ps.store_id = ?""",
        (store_id,),
    )
    by_url: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    for row in rows:
        normalized_url = _normalize_store_product_url(row["product_url"])
        normalized_name = _normalize_store_product_name(row["canonical_name"])
        payload = dict(row)
        if normalized_url and normalized_url not in by_url:
            by_url[normalized_url] = payload
        if normalized_name and normalized_name not in by_name:
            by_name[normalized_name] = payload
    return by_url, by_name


async def _find_any_product_by_name(db, canonical_name: str) -> Optional[dict]:
    rows = await db.execute_fetchall(
        """SELECT id, canonical_name, image_url
           FROM products
           WHERE lower(trim(canonical_name)) = lower(trim(?))
           ORDER BY id
           LIMIT 1""",
        (canonical_name,),
    )
    return dict(rows[0]) if rows else None


async def _merge_api_catalog_item(
    db,
    *,
    store_id: int,
    item: ApiProductPreview,
    existing_by_url: dict[str, dict],
    existing_by_name: dict[str, dict],
    create_if_missing: bool,
) -> tuple[str, Optional[int]]:
    # Permalinks/images come from the remote catalog feed, not the user —
    # drop non-web schemes instead of persisting them into <a href> data.
    # api:// is the internal sentinel for products with no web page.
    item = item.model_copy(update={
        "permalink": neutralize_web_url(item.permalink, allow_api_scheme=True) or "",
        "image_url": neutralize_web_url(item.image_url),
    })
    normalized_url = _normalize_store_product_url(item.permalink)
    normalized_name = _normalize_store_product_name(item.name)
    match = existing_by_url.get(normalized_url) or existing_by_name.get(normalized_name)
    if match is not None:
        if normalized_url and match.get("product_url") != item.permalink:
            await db.execute(
                "UPDATE product_stores SET product_url = ?, is_active = 1 WHERE id = ?",
                (item.permalink, match["product_store_id"]),
            )
            match["product_url"] = item.permalink
        if item.image_url and not match.get("image_url"):
            await db.execute(
                "UPDATE products SET image_url = ? WHERE id = ?",
                (item.image_url, match["product_id"]),
            )
            match["image_url"] = item.image_url
        if normalized_url:
            existing_by_url[normalized_url] = match
        if normalized_name:
            existing_by_name[normalized_name] = match
        return "existing", int(match["product_store_id"])

    if not create_if_missing:
        return "skipped", None

    scrape_config_json = ScrapeConfig(platform=f"{item.platform}_api").model_dump_json()
    existing_product = await _find_any_product_by_name(db, item.name)
    if existing_product is not None:
        product_id = existing_product["id"]
        product_store_id = await create_store_link(
            db,
            product_id=product_id,
            store_id=store_id,
            product_url=item.permalink,
            scrape_config_json=scrape_config_json,
            is_active=True,
        )
        if item.image_url and not existing_product.get("image_url"):
            await db.execute(
                "UPDATE products SET image_url = ? WHERE id = ?",
                (item.image_url, product_id),
            )
    else:
        product_id, product_store_id = await create_product_with_store(
            db,
            canonical_name=item.name,
            image_url=item.image_url,
            category_id=None,
            store_id=store_id,
            product_url=item.permalink,
            scrape_config_json=scrape_config_json,
        )

    payload = {
        "product_id": product_id,
        "canonical_name": item.name,
        "image_url": item.image_url,
        "product_store_id": product_store_id,
        "product_url": item.permalink,
    }
    if normalized_url:
        existing_by_url[normalized_url] = payload
    if normalized_name:
        existing_by_name[normalized_name] = payload
    return "created", product_store_id


def _effective_price(price: Optional[float], discounted_price: Optional[float]) -> Optional[float]:
    return discounted_price if discounted_price is not None else price


async def _latest_price_log(db, product_store_id: int) -> Optional[dict]:
    rows = await db.execute_fetchall(
        """SELECT price, discounted_price, stock_status
           FROM price_logs
           WHERE product_store_id = ?
           ORDER BY scraped_at DESC LIMIT 1""",
        (product_store_id,),
    )
    return dict(rows[0]) if rows else None


def _compute_api_change(
    previous: Optional[dict],
    item: ApiProductPreview,
) -> tuple[str, Optional[float], Optional[float], Optional[str]]:
    current_effective = _effective_price(item.price, item.discounted_price)
    current_stock = item.stock_status or "unknown"
    if previous is None:
        return "new", None, None, None

    previous_effective = _effective_price(previous.get("price"), previous.get("discounted_price"))
    previous_stock = previous.get("stock_status") or "unknown"
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
        return "price_and_stock", price_delta, previous_effective, previous_stock
    if price_changed:
        if price_delta is not None:
            return ("price_up" if price_delta > 0 else "price_down"), price_delta, previous_effective, previous_stock
        return "price_up", price_delta, previous_effective, previous_stock
    if stock_changed:
        if current_stock == "out_of_stock":
            return "stock_out", price_delta, previous_effective, previous_stock
        if current_stock in ("in_stock", "limited"):
            return "stock_in", price_delta, previous_effective, previous_stock
        return "stock_change", price_delta, previous_effective, previous_stock
    return "no_change", price_delta, previous_effective, previous_stock


async def _insert_api_snapshot(
    db,
    *,
    product_store_id: int,
    item: ApiProductPreview,
) -> tuple[ScrapeResult, str, Optional[float]]:
    previous = await _latest_price_log(db, product_store_id)
    change_type, price_delta, previous_price, previous_stock_status = _compute_api_change(previous, item)

    await db.execute(
        """INSERT INTO price_logs
           (product_store_id, title, price, discounted_price, dealer_price,
            stock_status, raw_price, raw_discounted, raw_dealer, currency_code,
            change_type, price_delta, previous_price, previous_stock_status)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?)""",
        (
            product_store_id,
            item.name,
            item.price,
            item.discounted_price,
            item.stock_status or "unknown",
            item.raw_price,
            item.raw_discounted,
            item.currency,
            change_type,
            price_delta,
            previous_price,
            previous_stock_status,
        ),
    )
    logger.info(
        "API synced ps_id=%d platform=%s -> regular=%s discounted=%s stock=%s change=%s delta=%s",
        product_store_id,
        item.platform,
        item.price,
        item.discounted_price,
        item.stock_status,
        change_type,
        price_delta,
    )
    result = ScrapeResult(
        title=item.name,
        price=item.price,
        discounted_price=item.discounted_price,
        dealer_price=None,
        stock_status=item.stock_status or "unknown",
        raw_price=item.raw_price,
        raw_discounted=item.raw_discounted,
        raw_dealer=None,
    )
    return result, change_type, price_delta


async def _update_store_api_metadata(
    db,
    *,
    store_id: int,
    platform: str,
    country_code: str,
    language: str,
    external_ids: list[str],
    api_config: dict[str, Any] | None = None,
) -> None:
    rows = await db.execute_fetchall(
        "SELECT api_config FROM stores WHERE id = ?",
        (store_id,),
    )
    current_config = _loads_api_config(rows[0]["api_config"]) if rows else {}
    raw_current_ids = current_config.get("external_ids", [])
    if not isinstance(raw_current_ids, list):
        raw_current_ids = []
    merged_ids: list[str] = []
    seen_ids: set[str] = set()
    for value in [
        *raw_current_ids,
        *external_ids,
    ]:
        normalized_values = _dedupe_external_ids(platform, [value])
        normalized = normalized_values[0] if normalized_values else str(value).strip()
        if not normalized or normalized in seen_ids:
            continue
        merged_ids.append(normalized)
        seen_ids.add(normalized)
    next_config = {
        **current_config,
        **(api_config or {}),
        "country_code": country_code,
        "language": language,
        "external_ids": merged_ids,
    }
    await db.execute(
        """UPDATE stores
           SET api_platform = ?,
               api_base_url = COALESCE(NULLIF(api_base_url, ''), ?),
               api_config = ?
           WHERE id = ?""",
        (
            platform,
            api_provider_base_url(platform),
            json.dumps(next_config, sort_keys=True),
            store_id,
        ),
    )


def _external_ids_from_store_config(store: Store) -> list[str]:
    values = store.api_config.get("external_ids") if isinstance(store.api_config, dict) else []
    if not isinstance(values, list):
        return []
    return [str(value) for value in values if str(value).strip()]


async def import_api_products(body: ApiImportRequest) -> dict[str, int]:
    platform = normalize_api_platform(body.platform)
    country_code = _normalize_country_code(body.country_code)
    language = _normalize_steam_language(body.language)
    external_ids = _dedupe_external_ids(platform, body.external_ids)
    if not external_ids:
        raise HTTPException(status_code=400, detail="Select at least one API product")

    db = await get_db()
    imported = 0
    existing = 0
    updated = 0
    try:
        store = await _get_store_or_404(db, body.store_id)
        request_config = {
            **(store.api_config if isinstance(store.api_config, dict) else {}),
            **(body.config if isinstance(body.config, dict) else {}),
        }
        previews = await fetch_api_preview_products(
            ApiPreviewRequest(
                platform=platform,
                external_ids=external_ids,
                country_code=country_code,
                language=language,
                limit=len(external_ids),
                base_url=body.base_url or store.api_base_url,
                api_key=body.api_key or store.api_key,
                config=request_config,
            )
        )
        existing_by_url, existing_by_name = await _existing_store_product_maps(db, body.store_id)
        for item in previews:
            outcome, product_store_id = await _merge_api_catalog_item(
                db,
                store_id=body.store_id,
                item=item,
                existing_by_url=existing_by_url,
                existing_by_name=existing_by_name,
                create_if_missing=True,
            )
            if outcome == "created":
                imported += 1
            elif outcome == "existing":
                existing += 1
            if product_store_id is not None:
                await _insert_api_snapshot(db, product_store_id=product_store_id, item=item)
                updated += 1

        await _update_store_api_metadata(
            db,
            store_id=body.store_id,
            platform=platform,
            country_code=country_code,
            language=language,
            external_ids=[item.external_id for item in previews],
            api_config=request_config,
        )
        await db.commit()
    finally:
        await db.close()

    return {"imported": imported, "existing": existing, "updated": updated}


def _store_api_country_language(store: Store) -> tuple[str, str]:
    config = store.api_config if isinstance(store.api_config, dict) else {}
    return (
        _normalize_country_code(config.get("country_code") or config.get("cc")),
        _normalize_steam_language(config.get("language")),
    )


async def _store_link_external_ids(db, store_id: int, platform: str) -> list[str]:
    rows = await db.execute_fetchall(
        """SELECT ps.product_url
           FROM product_stores ps
           WHERE ps.store_id = ?
             AND ps.is_active = 1""",
        (store_id,),
    )
    return _dedupe_external_ids(platform, [row["product_url"] for row in rows])


async def sync_store_api_catalog(store_id: int) -> ApiSyncResult:
    db = await get_db()
    try:
        store = await _get_store_or_404(db, store_id)
        if not store.api_enabled:
            raise HTTPException(status_code=400, detail="API sync is not enabled for this store")
        platform = normalize_api_platform(store.api_platform)
        country_code, language = _store_api_country_language(store)
        linked_ids = await _store_link_external_ids(db, store_id, platform)
        configured_ids = _dedupe_external_ids(platform, _external_ids_from_store_config(store))
        external_ids = _dedupe_external_ids(platform, [*linked_ids, *configured_ids])
        if not external_ids:
            raise HTTPException(status_code=400, detail="No API product IDs found for this store")

        previews = await fetch_api_preview_products(
            ApiPreviewRequest(
                platform=platform,
                external_ids=external_ids,
                country_code=country_code,
                language=language,
                limit=len(external_ids),
                base_url=store.api_base_url,
                api_key=store.api_key,
                config=store.api_config if isinstance(store.api_config, dict) else {},
            )
        )
        existing_by_url, existing_by_name = await _existing_store_product_maps(db, store_id)
        auto_import_new = bool(store.api_auto_import_new)
        created = 0
        existing = 0
        updated = 0
        for item in previews:
            outcome, product_store_id = await _merge_api_catalog_item(
                db,
                store_id=store_id,
                item=item,
                existing_by_url=existing_by_url,
                existing_by_name=existing_by_name,
                create_if_missing=auto_import_new,
            )
            if outcome == "created":
                created += 1
            elif outcome == "existing":
                existing += 1
            if product_store_id is not None:
                await _insert_api_snapshot(db, product_store_id=product_store_id, item=item)
                updated += 1

        await _update_store_api_metadata(
            db,
            store_id=store_id,
            platform=platform,
            country_code=country_code,
            language=language,
            external_ids=[item.external_id for item in previews],
            api_config=store.api_config if isinstance(store.api_config, dict) else {},
        )
        await db.execute(
            "UPDATE stores SET api_last_synced_at = CURRENT_TIMESTAMP WHERE id = ?",
            (store_id,),
        )
        await db.commit()
        refreshed = await _get_store_or_404(db, store_id)
        return ApiSyncResult(
            store_id=store_id,
            store_name=store.name,
            platform=platform,
            discovered=len(previews),
            created=created,
            existing=existing,
            updated=updated,
            auto_import_new=auto_import_new,
            synced_at=refreshed.api_last_synced_at,
        )
    finally:
        await db.close()


async def sync_all_enabled_api_stores() -> list[ApiSyncResult]:
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT id
               FROM stores
               WHERE api_enabled = 1
                 AND api_platform IS NOT NULL
               ORDER BY name"""
        )
        store_ids = [row["id"] for row in rows]
    finally:
        await db.close()

    results: list[ApiSyncResult] = []
    for store_id in store_ids:
        try:
            results.append(await sync_store_api_catalog(store_id))
        except Exception as exc:
            logger.error("API sync failed for store_id=%d: %s", store_id, exc)
    return results


async def sync_api_product_store(product_store_id: int) -> dict[str, Any]:
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            """SELECT
                   ps.product_url,
                   s.api_enabled,
                   s.api_platform,
                   s.api_base_url,
                   s.api_key,
                   s.api_config
               FROM product_stores ps
               JOIN stores s ON s.id = ps.store_id
               WHERE ps.id = ?
                 AND ps.is_active = 1""",
            (product_store_id,),
        )
        if not rows:
            return {
                "status": "not_found",
                "product_store_id": product_store_id,
                "error": "Product store not found or inactive",
            }
        row = rows[0]
        if not bool(row["api_enabled"]):
            return {
                "status": "skipped",
                "product_store_id": product_store_id,
                "reason": "api_sync_disabled",
            }
        platform = normalize_api_platform(row["api_platform"])
        api_config = _loads_api_config(row["api_config"])
        country_code = _normalize_country_code(api_config.get("country_code") or api_config.get("cc"))
        language = _normalize_steam_language(api_config.get("language"))
        product_external_ids = _dedupe_external_ids(platform, [row["product_url"]])
        configured_ids = _dedupe_external_ids(platform, _path_options(api_config.get("external_ids")))
        external_ids = product_external_ids or configured_ids
        if not external_ids:
            return {
                "status": "failed",
                "product_store_id": product_store_id,
                "error": f"Could not read an API product ID for {platform}",
            }
        previews = await fetch_api_preview_products(
            ApiPreviewRequest(
                platform=platform,
                external_ids=external_ids,
                country_code=country_code,
                language=language,
                limit=len(external_ids),
                base_url=row["api_base_url"],
                api_key=row["api_key"],
                config=api_config,
            )
        )
        product_url = _normalize_store_product_url(row["product_url"])
        if len(previews) > 1:
            previews = [
                preview
                for preview in previews
                if _normalize_store_product_url(preview.permalink) == product_url
            ] or previews[:1]
        if not previews:
            return {
                "status": "failed",
                "product_store_id": product_store_id,
                "error": f"No API result found for {platform} product",
            }
        result, change_type, price_delta = await _insert_api_snapshot(
            db,
            product_store_id=product_store_id,
            item=previews[0],
        )
        await db.commit()
        return {
            "status": "scraped",
            "product_store_id": product_store_id,
            "change_type": change_type,
            "price_delta": price_delta,
            "result": result,
        }
    finally:
        await db.close()

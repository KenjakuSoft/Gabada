from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.api_catalog import (  # noqa: E402
    _custom_preview_from_item,
    _apple_preview_from_item,
    _gog_preview_from_card_product,
    _steam_preview_from_detail,
    apple_app_id_from_value,
    gog_slug_from_value,
    steam_app_id_from_value,
)


def test_steam_app_id_from_url_or_plain_id() -> None:
    assert steam_app_id_from_value("1091500") == 1091500
    assert steam_app_id_from_value("https://store.steampowered.com/app/730/CounterStrike_2/") == 730
    assert steam_app_id_from_value("not a steam url") is None


def test_steam_detail_maps_discount_to_regular_and_discounted() -> None:
    preview = _steam_preview_from_detail(
        1091500,
        {
            "success": True,
            "data": {
                "name": "Cyberpunk 2077",
                "header_image": "https://example.test/header.jpg",
                "price_overview": {
                    "currency": "USD",
                    "initial": 5999,
                    "final": 2999,
                    "discount_percent": 50,
                    "initial_formatted": "$59.99",
                    "final_formatted": "$29.99",
                },
            },
        },
    )

    assert preview is not None
    assert preview.price == 59.99
    assert preview.discounted_price == 29.99
    assert preview.currency == "USD"
    assert preview.raw_price == "$59.99"
    assert preview.raw_discounted == "$29.99"


def test_steam_detail_keeps_current_price_as_regular_when_no_discount() -> None:
    preview = _steam_preview_from_detail(
        730,
        {
            "success": True,
            "data": {
                "name": "Counter-Strike 2",
                "is_free": True,
            },
        },
    )

    assert preview is not None
    assert preview.price == 0.0
    assert preview.discounted_price is None
    assert preview.raw_price == "Free"


def test_apple_app_store_preview_maps_itunes_search_result() -> None:
    assert apple_app_id_from_value("https://apps.apple.com/us/app/example/id123456789") == "123456789"

    preview = _apple_preview_from_item(
        {
            "trackId": 123456789,
            "trackName": "Example Game",
            "trackViewUrl": "https://apps.apple.com/us/app/example/id123456789",
            "price": 4.99,
            "formattedPrice": "$4.99",
            "currency": "USD",
            "artworkUrl100": "https://example.test/app.jpg",
            "genres": ["Games", "Action"],
        }
    )

    assert preview is not None
    assert preview.platform == "apple_app_store"
    assert preview.external_id == "123456789"
    assert preview.price == 4.99
    assert preview.discounted_price is None
    assert preview.currency == "USD"
    assert preview.categories == ["Games", "Action"]


def test_custom_json_preview_uses_configured_paths_and_discount_rules() -> None:
    preview = _custom_preview_from_item(
        "gog",
        {
            "sku": "game-1",
            "title": "Example RPG",
            "links": {"store": "/games/example-rpg"},
            "pricing": {
                "regular": "$29.99",
                "sale": "$14.99",
                "currency": "USD",
            },
            "available": True,
            "genres": [{"name": "RPG"}],
        },
        config={
            "external_id_path": "sku",
            "name_path": "title",
            "url_path": "links.store",
            "price_path": "pricing.regular",
            "discounted_price_path": "pricing.sale",
            "currency_path": "pricing.currency",
            "stock_path": "available",
            "categories_path": "genres",
        },
        base_url="https://www.gog.com",
    )

    assert preview is not None
    assert preview.platform == "gog"
    assert preview.external_id == "game-1"
    assert preview.permalink == "https://www.gog.com/games/example-rpg"
    assert preview.price == 29.99
    assert preview.discounted_price == 14.99
    assert preview.raw_price == "$29.99"
    assert preview.raw_discounted == "$14.99"
    assert preview.stock_status == "in_stock"


def test_gog_slug_from_url_or_plain_slug() -> None:
    assert gog_slug_from_value("https://www.gog.com/en/game/cyberpunk_2077") == "cyberpunk_2077"
    assert gog_slug_from_value("cyberpunk_2077") == "cyberpunk_2077"
    assert gog_slug_from_value("not a gog url") is None


def test_gog_card_product_maps_regular_and_discounted_prices() -> None:
    preview = _gog_preview_from_card_product(
        {
            "id": "2093619782",
            "url": "https://www.gog.com/en/game/cyberpunk_2077",
            "title": "Cyberpunk 2077",
            "image": "//images.gog-statics.com/cyberpunk.jpg",
            "price": {
                "finalAmount": "29.99",
                "baseAmount": "59.99",
                "discountPercentage": "50",
                "isFree": False,
            },
            "isAvailabilityInStock": True,
            "genres": [{"name": "Role-playing"}, {"name": "Action"}],
        },
        currency="USD",
        symbol="$",
    )

    assert preview is not None
    assert preview.platform == "gog"
    assert preview.external_id == "cyberpunk_2077"
    assert preview.price == 59.99
    assert preview.discounted_price == 29.99
    assert preview.raw_price == "$59.99"
    assert preview.raw_discounted == "$29.99"
    assert preview.stock_status == "in_stock"
    assert preview.image_url == "https://images.gog-statics.com/cyberpunk.jpg"

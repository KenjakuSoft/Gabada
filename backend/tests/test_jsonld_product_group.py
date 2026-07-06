"""Tests for JSON-LD ``ProductGroup`` / ``hasVariant`` aggregation.

Background: some Shopify storefronts emit a single
``@type: ProductGroup`` block whose actual ``Offer`` records — including
``availability`` — live one level down inside ``hasVariant[].offers``.
The previous parser only inspected the top-level ``offers`` field. For
the DualSense PS5 controller page that field is empty, so JSON-LD
returned ``stock_status="unknown"`` even though every variant on the
page was ``OutOfStock``. The waterfall then fell through to the smart
scan, which saw the (disabled) "Add to cart" copy and returned
``in_stock`` — a false positive on a clearly sold-out product.

These tests pin the new behaviour:
    - All variants OutOfStock → ``out_of_stock``
    - Any variant InStock → ``in_stock``
    - Lowest variant price wins
    - Plain ``Product`` with direct ``offers`` still works
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scraper.engine import _extract_jsonld_result_from_scripts  # noqa: E402


def _wrap(payload: dict) -> list[str]:
    return [json.dumps(payload)]


def test_product_group_all_variants_out_of_stock_yields_out_of_stock():
    payload = {
        "@context": "http://schema.org/",
        "@type": "ProductGroup",
        "name": "Sony PlayStation DualSense Wireless Controller",
        "hasVariant": [
            {
                "@type": "Product",
                "name": "DualSense - Black",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/OutOfStock",
                    "price": "23499.00",
                    "priceCurrency": "LKR",
                },
            },
            {
                "@type": "Product",
                "name": "DualSense - White",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/OutOfStock",
                    "price": "23999.00",
                    "priceCurrency": "LKR",
                },
            },
        ],
    }

    result = _extract_jsonld_result_from_scripts(_wrap(payload))
    assert result.stock_status == "out_of_stock"
    # Lowest available variant price wins.
    assert result.price == 23499.0
    assert "DualSense" in (result.title or "")


def test_product_group_any_variant_in_stock_yields_in_stock():
    payload = {
        "@context": "http://schema.org/",
        "@type": "ProductGroup",
        "name": "Mixed-availability product",
        "hasVariant": [
            {
                "@type": "Product",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/OutOfStock",
                    "price": "1500.00",
                },
            },
            {
                "@type": "Product",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/InStock",
                    "price": "1750.00",
                },
            },
        ],
    }

    result = _extract_jsonld_result_from_scripts(_wrap(payload))
    assert result.stock_status == "in_stock"
    # Lowest variant price still wins regardless of stock status.
    assert result.price == 1500.0


def test_product_group_preorder_variant_outranks_unknown():
    payload = {
        "@context": "http://schema.org/",
        "@type": "ProductGroup",
        "name": "Preorder variant",
        "hasVariant": [
            {
                "@type": "Product",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/OutOfStock",
                    "price": "100.00",
                },
            },
            {
                "@type": "Product",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/PreOrder",
                    "price": "120.00",
                },
            },
        ],
    }

    result = _extract_jsonld_result_from_scripts(_wrap(payload))
    # PreOrder beats OutOfStock when both are present (none in stock).
    assert result.stock_status == "preorder"


def test_plain_product_with_direct_offers_unchanged():
    payload = {
        "@context": "http://schema.org/",
        "@type": "Product",
        "name": "Single SKU product",
        "offers": {
            "@type": "Offer",
            "availability": "http://schema.org/InStock",
            "price": "999.00",
        },
    }

    result = _extract_jsonld_result_from_scripts(_wrap(payload))
    assert result.stock_status == "in_stock"
    assert result.price == 999.0
    assert result.title == "Single SKU product"


def test_aggregate_offer_low_price_used_when_no_direct_price():
    payload = {
        "@context": "http://schema.org/",
        "@type": "Product",
        "name": "Aggregate-offer product",
        "offers": {
            "@type": "AggregateOffer",
            "availability": "http://schema.org/OutOfStock",
            "lowPrice": "150.00",
            "highPrice": "300.00",
        },
    }

    result = _extract_jsonld_result_from_scripts(_wrap(payload))
    assert result.stock_status == "out_of_stock"
    assert result.price == 150.0


def test_product_group_with_no_variants_falls_back_to_unknown():
    payload = {
        "@context": "http://schema.org/",
        "@type": "ProductGroup",
        "name": "Empty group",
    }

    result = _extract_jsonld_result_from_scripts(_wrap(payload))
    # No offers, no variants — nothing to extract beyond the name.
    assert result.title == "Empty group"
    assert result.price is None
    assert result.stock_status == "unknown"


def test_real_shopify_variant_payload_yields_out_of_stock():
    """Replays a real store's /products/sony-playstation-dualsense ProductGroup.

    Trimmed to two of the four variants — the structure is identical
    across the others.
    """
    payload = {
        "@context": "http://schema.org/",
        "@type": "ProductGroup",
        "name": "Sony PlayStation DualSense® Wireless Controller (PS5)",
        "hasVariant": [
            {
                "@type": "Product",
                "name": "DualSense - Black",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/OutOfStock",
                    "price": "23499.00",
                    "priceCurrency": "LKR",
                },
            },
            {
                "@type": "Product",
                "name": "DualSense - White",
                "offers": {
                    "@type": "Offer",
                    "availability": "http://schema.org/OutOfStock",
                    "price": "23499.00",
                    "priceCurrency": "LKR",
                },
            },
        ],
    }

    result = _extract_jsonld_result_from_scripts(_wrap(payload))
    assert result.stock_status == "out_of_stock"
    assert result.price == 23499.0

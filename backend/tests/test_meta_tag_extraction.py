from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scraper.engine import _meta_tags_result  # noqa: E402


def test_og_product_price_and_currency() -> None:
    result = _meta_tags_result([
        ("og:title", "Widget | Shop"),
        ("product:price:amount", "168000.00"),
        ("product:price:currency", "LKR"),
    ])
    assert result.price == 168000.0
    assert result.raw_price == "LKR 168000.00"
    assert result.discounted_price is None


def test_sale_price_maps_to_discounted() -> None:
    result = _meta_tags_result([
        ("product:price:amount", "1000"),
        ("product:sale_price:amount", "800"),
    ])
    assert result.price == 1000.0
    assert result.discounted_price == 800.0


def test_zero_amount_is_ignored() -> None:
    result = _meta_tags_result([("og:price:amount", "0.00")])
    assert result.price is None


def test_twitter_price_label_pair() -> None:
    result = _meta_tags_result([
        ("twitter:label1", "Price"),
        ("twitter:data1", "$49.99"),
    ])
    assert result.price == 49.99


def test_twitter_data_ignored_without_price_label() -> None:
    result = _meta_tags_result([
        ("twitter:label1", "Reading time"),
        ("twitter:data1", "12 minutes"),
    ])
    assert result.price is None


def test_availability_parses_instock_and_out_of_stock() -> None:
    assert (
        _meta_tags_result([("og:availability", "instock")]).stock_status
        == "in_stock"
    )
    assert (
        _meta_tags_result([("product:availability", "out of stock")]).stock_status
        == "out_of_stock"
    )


def test_first_occurrence_wins_for_duplicated_tags() -> None:
    result = _meta_tags_result([
        ("og:price:amount", "500"),
        ("og:price:amount", "999"),
    ])
    assert result.price == 500.0


def test_currency_not_duplicated_when_raw_already_has_it() -> None:
    result = _meta_tags_result([
        ("og:price:amount", "LKR 5,000"),
        ("og:price:currency", "LKR"),
    ])
    assert result.price == 5000.0
    assert result.raw_price == "LKR 5,000"


def test_empty_pairs_produce_empty_result() -> None:
    result = _meta_tags_result([])
    assert result.price is None
    assert result.discounted_price is None
    assert result.stock_status in (None, "unknown")

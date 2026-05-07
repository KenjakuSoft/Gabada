"""Tests for the buy-area content dump.

Phase 1 of the self-adaptive scraper rework adds a ``buy_area`` field
to ``ProbeResponse`` and ``SelectorLabResponse``: an ordered list of
every visible item the JS detected inside the buy-box. Storefronts
that surface non-numeric "prices" (PlayStation Store's
"Free with PS Plus" / "Game Trial", Xbox's "Included with Game Pass",
Epic's "Coming Soon") become representable as ``kind="price"`` items
with ``value=None`` and a ``qualifier`` string.

These tests exercise the Python coercion layer with synthetic raw
items so they run without spinning up a browser. The JS classifier
itself is exercised end-to-end via the existing scratch probe script
and the live test URLs the user runs.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database.models import BuyAreaItem  # noqa: E402
from scraper.engine import _coerce_buy_area_items  # noqa: E402


def test_coerce_normalises_kind_and_drops_empty_text() -> None:
    raw = [
        {"kind": "price", "text": "$29.99", "value": 29.99, "order": 0},
        {"kind": "PRICE", "text": "$10.00", "value": 10.0, "order": 1},
        {"kind": "weird-thing", "text": "labelish", "order": 2},
        {"kind": "price", "text": "", "value": 9.99, "order": 3},
        {"kind": "price", "text": "   ", "value": 9.99, "order": 4},
    ]
    items = _coerce_buy_area_items(raw)
    assert [it.kind for it in items] == ["price", "price", "other"]
    assert [it.text for it in items] == ["$29.99", "$10.00", "labelish"]


def test_coerce_handles_qualifier_price_with_null_value() -> None:
    """PlayStation Store / Xbox / Epic style non-numeric prices."""
    raw = [
        {
            "kind": "price",
            "text": "Free with PS Plus",
            "value": None,
            "qualifier": "Free with PS Plus",
            "selector": ".ps-plus-tier > span.price",
            "dom_path": "div.tiers > div.ps-plus > span.price",
            "tag": "span",
            "order": 0,
        },
        {
            "kind": "price",
            "text": "Game Trial",
            "value": None,
            "qualifier": "Game Trial",
            "tag": "span",
            "order": 1,
        },
        {
            "kind": "price",
            "text": "Coming Soon",
            "value": None,
            "qualifier": "Coming Soon",
            "tag": "span",
            "order": 2,
        },
    ]
    items = _coerce_buy_area_items(raw)
    assert len(items) == 3
    for item in items:
        assert item.kind == "price"
        assert item.value is None
        assert item.qualifier is not None
    assert items[0].qualifier == "Free with PS Plus"


def test_coerce_preserves_struck_and_button_flags() -> None:
    raw = [
        {
            "kind": "price",
            "text": "Rs 275,000",
            "value": 275000.0,
            "struck": True,
            "tag": "span",
            "order": 0,
        },
        {
            "kind": "stock",
            "text": "Add to Cart",
            "is_button": True,
            "is_disabled": False,
            "tag": "button",
            "order": 1,
        },
    ]
    items = _coerce_buy_area_items(raw)
    assert items[0].struck is True
    assert items[0].is_button is False
    assert items[1].kind == "stock"
    assert items[1].is_button is True
    assert items[1].is_disabled is False


def test_coerce_respects_text_and_qualifier_length_caps() -> None:
    """Defensive truncation so a runaway DOM blob can't poison the response."""
    long_text = "x" * 1000
    raw = [
        {
            "kind": "label",
            "text": long_text,
            "qualifier": long_text,
            "selector": "div." + ("x" * 1000),
            "dom_path": "div." + ("y" * 1000),
            "label_before": long_text,
            "label_after": long_text,
            "near_price": long_text,
            "order": 0,
        }
    ]
    items = _coerce_buy_area_items(raw)
    assert len(items) == 1
    item = items[0]
    assert len(item.text) <= 240
    assert item.qualifier is not None and len(item.qualifier) <= 160
    assert item.selector is not None and len(item.selector) <= 240
    assert item.dom_path is not None and len(item.dom_path) <= 240
    assert item.label_before is not None and len(item.label_before) <= 160
    assert item.label_after is not None and len(item.label_after) <= 160
    assert item.near_price is not None and len(item.near_price) <= 160


def test_coerce_drops_malformed_entries_without_breaking_response() -> None:
    raw = [
        "this is not a dict",
        {"kind": "price", "text": "valid", "order": 0},
        None,
        {"kind": "price"},  # missing text
        42,
    ]
    items = _coerce_buy_area_items(raw)
    assert [it.text for it in items] == ["valid"]


def test_coerce_filters_near_badges_to_strings() -> None:
    raw = [
        {
            "kind": "price",
            "text": "$29.99",
            "value": 29.99,
            "near_badges": ["-40%", None, "", "SALE", 12345],
            "order": 0,
        }
    ]
    items = _coerce_buy_area_items(raw)
    assert items[0].near_badges == ["-40%", "SALE", "12345"]


def test_buy_area_item_value_can_be_int_or_float() -> None:
    """Pydantic should accept both ints and floats for the price value."""
    item_int = BuyAreaItem(kind="price", text="29", value=29)
    item_float = BuyAreaItem(kind="price", text="$29.99", value=29.99)
    assert item_int.value == 29
    assert item_float.value == 29.99


if __name__ == "__main__":
    tests = [
        test_coerce_normalises_kind_and_drops_empty_text,
        test_coerce_handles_qualifier_price_with_null_value,
        test_coerce_preserves_struck_and_button_flags,
        test_coerce_respects_text_and_qualifier_length_caps,
        test_coerce_drops_malformed_entries_without_breaking_response,
        test_coerce_filters_near_badges_to_strings,
        test_buy_area_item_value_can_be_int_or_float,
    ]
    for t in tests:
        t()
        print(f"OK: {t.__name__}")
    print(f"All {len(tests)} tests passed.")

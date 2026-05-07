"""Tests for the buy-area pick replay engine (Phase 2a).

The user pins a ``BuyAreaPick`` in the Selector Lab and the engine replays
it on every subsequent scrape: re-runs the buy-area dump, scores live
items against the saved fingerprint, and overrides the matching schema
field. These tests exercise the scoring + apply layer with synthetic
inputs so they run without spinning up a browser or database.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database.models import BuyAreaItem, BuyAreaPick, ScrapeResult  # noqa: E402
from scraper.engine import (  # noqa: E402
    _apply_buy_area_picks,
    _best_match_for_pick,
    _buy_area_pick_score,
)


def _item(**overrides) -> BuyAreaItem:
    base = dict(
        kind="price",
        text="$29.99",
        value=29.99,
        selector="div.summary > span.price",
        dom_path="div.summary > span.price",
        tag="span",
        order=0,
    )
    base.update(overrides)
    return BuyAreaItem(**base)


def _pick(**overrides) -> BuyAreaPick:
    base = dict(
        target_field="price",
        kind="price",
        text="$29.99",
        value=29.99,
        selector="div.summary > span.price",
        dom_path="div.summary > span.price",
    )
    base.update(overrides)
    return BuyAreaPick(**base)


# ── _buy_area_pick_score ────────────────────────────────────────────────────


def test_score_exact_selector_dominates() -> None:
    pick = _pick(label_before=None, qualifier=None)
    item = _item(label_before=None, qualifier=None)
    # selector +50, dom_path +20, kind +10, value +5 = 85
    assert _buy_area_pick_score(pick, item) == 85


def test_score_selector_only_match() -> None:
    pick = _pick(dom_path=None, label_before=None, qualifier=None, value=None)
    item = _item(dom_path="completely.different > path", value=None)
    # selector +50, kind +10 = 60
    assert _buy_area_pick_score(pick, item) == 60


def test_score_no_signal_returns_zero() -> None:
    pick = _pick(
        selector="a.b",
        dom_path=None,
        kind="",
        value=None,
        qualifier=None,
        label_before=None,
        label_after=None,
    )
    item = _item(
        selector="x.y",
        dom_path=None,
        kind="",
        value=None,
        qualifier=None,
        label_before=None,
        label_after=None,
    )
    assert _buy_area_pick_score(pick, item) == 0


def test_score_qualifier_match_lifts_a_class_rotation() -> None:
    """Class hash rotation can void selector + dom_path matches but the
    qualifier (e.g. "Free with PS Plus") often survives — the pick should
    still match strongly enough to apply."""
    pick = _pick(
        selector="span.css-abc123",
        dom_path="div.css-old > span.css-old",
        qualifier="Free with PS Plus",
        kind="price",
        value=None,
        label_before="PS Plus members",
    )
    item = _item(
        selector="span.css-xyz789",  # rotated
        dom_path="div.css-new > span.css-new",  # rotated
        qualifier="Free with PS Plus",  # stable text
        kind="price",
        value=None,
        label_before="PS Plus members",
    )
    # kind +10, qualifier +15, label_before +10 = 35 (above the 30 threshold)
    assert _buy_area_pick_score(pick, item) >= 30


def test_score_value_drift_within_tolerance() -> None:
    pick = _pick(value=1000.0, dom_path=None, label_before=None, qualifier=None)
    item = _item(value=1040.0, dom_path=None, label_before=None, qualifier=None)
    # 1040/1000 = 4% drift, within 5% tolerance
    # selector +50, kind +10, value +5 = 65
    assert _buy_area_pick_score(pick, item) == 65


def test_score_value_drift_outside_tolerance() -> None:
    pick = _pick(value=1000.0, dom_path=None, label_before=None, qualifier=None)
    item = _item(value=1500.0, dom_path=None, label_before=None, qualifier=None)
    # 50% drift, outside tolerance — value bonus dropped
    # selector +50, kind +10 = 60
    assert _buy_area_pick_score(pick, item) == 60


# ── _best_match_for_pick ────────────────────────────────────────────────────


def test_best_match_picks_highest_scoring_item() -> None:
    pick = _pick(
        selector="span.target",
        dom_path="div.parent > span.target",
        qualifier=None,
        label_before=None,
    )
    items = [
        _item(selector="span.other", dom_path="div.other > span.other", order=0),
        _item(selector="span.target", dom_path="div.parent > span.target", order=1),
        _item(selector="span.also-other", dom_path="div.x > span.x", order=2),
    ]
    match, score = _best_match_for_pick(pick, items)
    assert match is items[1]
    assert score >= 30


def test_best_match_returns_none_for_empty_items() -> None:
    pick = _pick()
    match, score = _best_match_for_pick(pick, [])
    assert match is None
    assert score == 0


# ── _apply_buy_area_picks ───────────────────────────────────────────────────


def test_apply_overrides_price_when_pick_matches() -> None:
    result = ScrapeResult(price=999.99, raw_price="$999.99")
    pick = _pick(
        target_field="price",
        value=29.99,
        text="$29.99",
        selector="span.target",
        dom_path="div.x > span.target",
    )
    items = [_item(selector="span.target", dom_path="div.x > span.target", value=29.99, text="$29.99")]
    out = _apply_buy_area_picks(result, [pick], items)
    assert out.price == 29.99
    assert out.raw_price == "$29.99"
    assert out.review_status == "ok"


def test_apply_falls_back_when_match_below_threshold() -> None:
    """No live item resembles the saved pick → keep waterfall result, flag
    review_status=needs_review with a clear note."""
    result = ScrapeResult(price=999.99, raw_price="$999.99")
    pick = _pick(
        target_field="price",
        selector="span.gone",
        dom_path="div.gone > span.gone",
        kind="",
        qualifier=None,
        label_before=None,
        label_after=None,
        value=None,
    )
    items = [_item(selector="span.unrelated", dom_path="div.x > span.x", kind="label", value=None)]
    out = _apply_buy_area_picks(result, [pick], items)
    assert out.price == 999.99  # unchanged
    assert out.review_status == "needs_review"
    assert any("could not be matched" in n for n in out.review_notes)


def test_apply_free_qualifier_pick_sets_zero_price() -> None:
    """User pinned 'Free with PS Plus' as the price; live item is also a
    qualifier with no numeric value, so it should track as a zero price.
    """
    result = ScrapeResult(price=29.99, raw_price="$29.99")
    pick = _pick(
        target_field="price",
        kind="price",
        qualifier="Free with PS Plus",
        value=None,
        selector="span.ps-plus",
        dom_path="div.tier > span.ps-plus",
        text="Free with PS Plus",
    )
    items = [_item(
        selector="span.ps-plus",
        dom_path="div.tier > span.ps-plus",
        kind="price",
        qualifier="Free with PS Plus",
        value=None,
        text="Free with PS Plus",
    )]
    out = _apply_buy_area_picks(result, [pick], items)
    assert out.price == 0.0
    assert out.raw_price == "Free with PS Plus"
    assert not any("non-numeric" in n for n in out.review_notes)


def test_apply_handles_stock_status_pick() -> None:
    result = ScrapeResult(price=29.99, stock_status="unknown")
    pick = _pick(
        target_field="stock_status",
        kind="stock",
        text="Add to Cart",
        value=None,
        selector="button.add-to-cart",
        dom_path="div.buy > button.add-to-cart",
    )
    items = [_item(
        selector="button.add-to-cart",
        dom_path="div.buy > button.add-to-cart",
        kind="stock",
        text="Add to Cart",
        value=None,
        is_button=True,
    )]
    out = _apply_buy_area_picks(result, [pick], items)
    assert out.stock_status == "in_stock"


def test_apply_handles_title_pick() -> None:
    result = ScrapeResult(title=None, price=29.99)
    pick = _pick(
        target_field="title",
        kind="title",
        text="Original Title",
        value=None,
        selector="h1.product",
        dom_path="div.x > h1.product",
    )
    items = [_item(
        selector="h1.product",
        dom_path="div.x > h1.product",
        kind="title",
        text="Live Page Title",
        value=None,
    )]
    out = _apply_buy_area_picks(result, [pick], items)
    assert out.title == "Live Page Title"


def test_apply_no_picks_returns_unchanged_result() -> None:
    result = ScrapeResult(price=29.99, raw_price="$29.99", stock_status="in_stock")
    out = _apply_buy_area_picks(result, [], [_item()])
    assert out.price == 29.99
    assert out.review_status == "ok"
    assert out.review_notes == []


def test_apply_empty_live_items_surfaces_block_warning() -> None:
    """No buy-area visible at all (e.g. partial bot block) → don't override
    anything, but flag the result clearly so the user knows their pinned
    picks didn't run this time."""
    result = ScrapeResult(price=29.99, raw_price="$29.99")
    pick = _pick(target_field="price")
    out = _apply_buy_area_picks(result, [pick], [])
    assert out.price == 29.99  # waterfall result preserved
    assert out.review_status == "needs_review"
    assert any("not visible" in n.lower() for n in out.review_notes)


def test_apply_ignores_unknown_target_field() -> None:
    """Defensive: a pick with a garbage target_field shouldn't crash
    or accidentally clobber a real field."""
    result = ScrapeResult(price=29.99, raw_price="$29.99")
    pick = _pick(target_field="not_a_real_field")
    items = [_item()]
    out = _apply_buy_area_picks(result, [pick], items)
    assert out.price == 29.99


if __name__ == "__main__":
    tests = [
        test_score_exact_selector_dominates,
        test_score_selector_only_match,
        test_score_no_signal_returns_zero,
        test_score_qualifier_match_lifts_a_class_rotation,
        test_score_value_drift_within_tolerance,
        test_score_value_drift_outside_tolerance,
        test_best_match_picks_highest_scoring_item,
        test_best_match_returns_none_for_empty_items,
        test_apply_overrides_price_when_pick_matches,
        test_apply_falls_back_when_match_below_threshold,
        test_apply_free_qualifier_pick_sets_zero_price,
        test_apply_handles_stock_status_pick,
        test_apply_handles_title_pick,
        test_apply_no_picks_returns_unchanged_result,
        test_apply_empty_live_items_surfaces_block_warning,
        test_apply_ignores_unknown_target_field,
    ]
    for t in tests:
        t()
        print(f"OK: {t.__name__}")
    print(f"All {len(tests)} tests passed.")

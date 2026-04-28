"""Test the extreme-divergence guardrail in _review_result_with_smart_scan.

Simulates the Nexxcom bug: JSON-LD reports Rs 54,000 but smart-scan latches
onto a stray "rs 4" fragment (e.g. inside a product description). Before the
fix, the review logic adopted Rs 4. After the fix, the structured-data price
is preserved when the divergence is implausibly large (>=50x).
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database.models import ScrapeResult  # noqa: E402
from scraper.engine import _review_result_with_smart_scan  # noqa: E402


def _smart_data(value: float, score: int = 54) -> dict:
    return {
        "main": {
            "value": value,
            "score": score,
            "selector": "div.summary.entry-summary div.short-description",
            "dom_path": "div.summary > div.short-description-wrapper > div",
            "tag": "div",
            "node_text": f"rs {int(value)}",
        },
        "original": None,
        "dealer": None,
    }


def test_extreme_divergence_keeps_structured_price() -> None:
    # JSON-LD found the real price (Rs 54,000); raw is just plain digits.
    result = ScrapeResult(
        title="Elgato HD60 S+",
        price=54000.0,
        raw_price="54000",
        stock_status="in_stock",
    )
    # Smart scan latched onto a stray "rs 4" fragment.
    smart = ScrapeResult(price=4.0, raw_price="rs 4")
    smart_data = _smart_data(value=4.0, score=54)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    assert reviewed.price == 54000.0, f"expected 54000.0, got {reviewed.price}"
    assert reviewed.discounted_price is None
    # Should NOT be marked as "corrected" — we kept the structured price.
    assert reviewed.review_status != "corrected"
    # Should leave a clear note.
    assert any("structured-data price" in n for n in reviewed.review_notes), reviewed.review_notes
    # Should expose the rejected smart-scan candidate so the UI can show a switch.
    assert reviewed.review_alternative_price == 4.0
    assert reviewed.review_alternative_raw == "rs 4"
    assert reviewed.review_alternative_label is not None
    assert "rejected" in reviewed.review_alternative_label.lower()


def test_corrected_price_exposes_original_as_alternative() -> None:
    # Genuine sale path: smart-scan adopts a lower price as the "corrected"
    # current. The original extracted price should be surfaced as an
    # alternative so the user can switch back if the correction was wrong.
    result = ScrapeResult(price=1000.0, raw_price="1000")
    smart = ScrapeResult(price=500.0, raw_price="Rs 500.00")
    smart_data = _smart_data(value=500.0, score=80)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    assert reviewed.price == 500.0
    assert reviewed.review_status == "corrected"
    assert reviewed.review_alternative_price == 1000.0
    assert reviewed.review_alternative_raw == "1000"
    assert reviewed.review_alternative_label == "original extracted price"


def test_moderate_divergence_still_adopts_smart() -> None:
    # Genuine sale: JSON-LD says 1000, smart-scan finds 500 (2x ratio).
    # This should still be adopted as before.
    result = ScrapeResult(price=1000.0, raw_price="1000")
    smart = ScrapeResult(price=500.0, raw_price="Rs 500.00")
    smart_data = _smart_data(value=500.0, score=80)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    assert reviewed.price == 500.0, f"expected 500.0, got {reviewed.price}"
    assert reviewed.review_status == "corrected"


def test_extreme_divergence_with_non_price_custom_keeps_structured_price() -> None:
    # Platform defaults or a title-only custom selector should not weaken the
    # structured-price guardrail. Only an actual price lock is authoritative.
    result = ScrapeResult(price=54000.0, raw_price="54000")
    smart = ScrapeResult(price=4.0, raw_price="rs 4")
    smart_data = _smart_data(value=4.0, score=54)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=True,
        structured_price_locked=True,
        user_locks={"title"},
    )

    assert reviewed.price == 54000.0
    assert reviewed.review_status != "corrected"
    assert reviewed.review_alternative_price == 4.0


def test_no_structured_price_lock_runs_normal_review() -> None:
    # Without a structured-price lock, the guardrail does not apply.
    result = ScrapeResult(price=54000.0, raw_price="54000")
    smart = ScrapeResult(price=4.0, raw_price="rs 4")
    smart_data = _smart_data(value=4.0, score=54)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=False,
    )

    # Without the lock, normal review behaviour determines outcome.
    assert reviewed.price in (54000.0, 4.0)


def test_user_locked_price_is_authoritative_over_smart_scan() -> None:
    # User explicitly mapped the price selector in Selector Lab. Even if smart
    # scan disagrees, the user's pick wins; smart scan is surfaced as an
    # alternative for one-click switching, not as a silent override.
    result = ScrapeResult(price=42000.0, raw_price="Rs 42,000.00")
    smart = ScrapeResult(price=4200.0, raw_price="Rs 4,200")
    smart_data = _smart_data(value=4200.0, score=80)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=True,
        structured_price_locked=False,
        user_locks={"price"},
    )

    assert reviewed.price == 42000.0, f"expected user-locked 42000.0, got {reviewed.price}"
    assert reviewed.review_status != "corrected"
    assert reviewed.review_alternative_price == 4200.0
    assert reviewed.review_alternative_label == "smart-scan candidate"


def test_user_driven_test_does_not_emit_corrected_for_added_dealer() -> None:
    # Selector Lab test: user pinned price, did NOT pin dealer. Smart scan
    # invents a dealer-looking number. The result must NOT be marked
    # "corrected" — that banner ("Review corrected a suspicious scrape result")
    # was misleading the user into thinking their pick was rejected.
    result = ScrapeResult(price=15000.0, raw_price="Rs 15,000.00")
    smart = ScrapeResult(
        price=15000.0,
        raw_price="Rs 15,000",
        dealer_price=12345.0,
        raw_dealer="Rs 12,345",
    )
    smart_data = _smart_data(value=15000.0, score=70)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=True,
        structured_price_locked=False,
        user_locks={"price"},
    )

    assert reviewed.price == 15000.0
    assert reviewed.review_status != "corrected", (
        f"User-driven Selector Lab test must not flip review_status to "
        f"'corrected'; got {reviewed.review_status}"
    )
    # Smart-scan dealer should NOT be silently added when user is driving.
    assert reviewed.dealer_price is None


def test_user_locked_dealer_price_is_authoritative() -> None:
    # User mapped a dealer-price selector. Smart scan's dealer guess must not
    # silently overwrite it.
    result = ScrapeResult(
        price=42000.0,
        raw_price="Rs 42,000",
        dealer_price=38000.0,
        raw_dealer="Rs 38,000",
    )
    smart = ScrapeResult(
        price=42000.0,
        raw_price="Rs 42,000",
        dealer_price=12345.0,
        raw_dealer="Rs 12,345",
    )
    smart_data = _smart_data(value=42000.0, score=80)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=True,
        structured_price_locked=False,
        user_locks={"price", "dealer_price"},
    )

    assert reviewed.dealer_price == 38000.0
    assert reviewed.raw_dealer == "Rs 38,000"


if __name__ == "__main__":
    tests = [
        test_extreme_divergence_keeps_structured_price,
        test_corrected_price_exposes_original_as_alternative,
        test_moderate_divergence_still_adopts_smart,
        test_extreme_divergence_with_non_price_custom_keeps_structured_price,
        test_no_structured_price_lock_runs_normal_review,
        test_user_locked_price_is_authoritative_over_smart_scan,
        test_user_driven_test_does_not_emit_corrected_for_added_dealer,
        test_user_locked_dealer_price_is_authoritative,
    ]
    for t in tests:
        t()
        print(f"OK: {t.__name__}")
    print(f"All {len(tests)} tests passed.")

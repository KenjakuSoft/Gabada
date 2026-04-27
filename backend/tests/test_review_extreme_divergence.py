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


def test_extreme_divergence_with_custom_selector_still_runs_review() -> None:
    # If the user pinned a custom selector, they presumably know what
    # they're doing — skip the guardrail and let the normal logic run.
    result = ScrapeResult(price=54000.0, raw_price="54000")
    smart = ScrapeResult(price=4.0, raw_price="rs 4")
    smart_data = _smart_data(value=4.0, score=54)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=True,
        structured_price_locked=True,
    )

    # With custom selector, the guardrail does not short-circuit, so the
    # original review behaviour applies.
    assert reviewed.price in (54000.0, 4.0)


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


if __name__ == "__main__":
    tests = [
        test_extreme_divergence_keeps_structured_price,
        test_corrected_price_exposes_original_as_alternative,
        test_moderate_divergence_still_adopts_smart,
        test_extreme_divergence_with_custom_selector_still_runs_review,
        test_no_structured_price_lock_runs_normal_review,
    ]
    for t in tests:
        t()
        print(f"OK: {t.__name__}")
    print(f"All {len(tests)} tests passed.")

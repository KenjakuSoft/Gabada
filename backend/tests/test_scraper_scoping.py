"""Tests for the buy-box scoping and reviewer authority changes.

These cover the regression class: "fix one site, break another" where the
scraper picked up prices from outside the actual buy-box (related products,
mini-cart subtotal, recently-viewed, footer testimonials) because either:

  - ``_apply_custom`` always fell back to a page-wide query when scoped
    queries returned nothing, and
  - The reviewer treated structured-data plain-digit raws (``"275000.00"``)
    as "weak signal" and let smart-scan override them, and
  - The smart-scan re-scanned ``document.body`` whenever the focused
    buy-box scope produced fewer than two candidates.

The fix tightens all three. These tests don't spin up a browser; they
exercise the pure-Python helpers directly so they run fast and stay
deterministic.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database.models import ScrapeResult  # noqa: E402
from scraper.engine import (  # noqa: E402
    _get_product_root,
    _resolve_custom_stock_status,
    _review_result_with_smart_scan,
)
from scraper.site_profiles import PLATFORM_SELECTORS  # noqa: E402


def _smart_data(
    *,
    main_value: float | None = None,
    main_text: str | None = None,
    used_body_fallback: bool = False,
    score: int = 60,
) -> dict:
    main = None
    if main_value is not None:
        main = {
            "value": main_value,
            "score": score,
            "selector": "div.summary > span.price",
            "dom_path": "div.summary > span.price",
            "tag": "span",
            "node_text": main_text or f"Rs {int(main_value)}",
        }
    return {
        "main": main,
        "original": None,
        "dealer": None,
        "used_body_fallback": used_body_fallback,
    }


def test_structured_plain_digit_raw_not_overridden_when_no_other_signal() -> None:
    """JSON-LD plain ``"275000"`` raw must not be flagged as suspicious so that
    a smart-scan candidate without other override signals (no major divergence,
    no custom selectors) cannot silently replace it."""
    result = ScrapeResult(price=275000.0, raw_price="275000")
    # Smart finds a slightly different value but raw alone shouldn't be enough
    # to override the structured price.
    smart = ScrapeResult(price=270000.0, raw_price="Rs 270,000")
    smart_data = _smart_data(main_value=270000.0, main_text="Rs 270,000", score=70)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    # 275000 vs 270000 ratio is 1.018 — below the 1.25 major_divergence
    # threshold and below 50x extreme. With the fix, the structured price
    # stays put because plain-digit raw is no longer "suspicious".
    assert reviewed.price == 275000.0, (
        f"Structured price 275000 must not be overridden by smart-scan "
        f"270000 when raw signal is the only argument; got {reviewed.price}"
    )
    assert reviewed.review_status != "corrected"


def test_body_fallback_smart_scan_cannot_override_structured_price() -> None:
    """Smart scan that had to fall back to ``document.body`` (no buy-box found)
    must not silently replace a structured-data price even when the divergence
    looks "major" — the candidate could have come from anywhere on the page.
    """
    result = ScrapeResult(price=54000.0, raw_price="54000")
    smart = ScrapeResult(price=12000.0, raw_price="Rs 12,000")
    smart_data = _smart_data(
        main_value=12000.0,
        main_text="Rs 12,000",
        used_body_fallback=True,
        score=80,
    )

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    assert reviewed.price == 54000.0, (
        f"Body-fallback smart-scan must not override structured price; "
        f"got {reviewed.price}"
    )
    assert reviewed.review_status != "corrected"


def test_body_fallback_smart_scan_cannot_enrich_structured_sale_pair() -> None:
    """Body fallback must not add a regular/sale pair to a structured price.

    The current price can legitimately match structured data while the
    "original" price candidate came from unrelated page content.
    """
    result = ScrapeResult(price=54000.0, raw_price="54000")
    smart = ScrapeResult(
        price=65000.0,
        discounted_price=54000.0,
        raw_price="Rs 65,000",
        raw_discounted="Rs 54,000",
    )
    smart_data = _smart_data(
        main_value=54000.0,
        main_text="Rs 54,000",
        used_body_fallback=True,
        score=80,
    )
    smart_data["original"] = {
        "value": 65000.0,
        "score": 70,
        "text": "Rs 65,000",
        "struck": True,
        "near_sale_signal": True,
    }

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    assert reviewed.price == 54000.0
    assert reviewed.discounted_price is None
    assert reviewed.raw_price == "54000"


def test_body_fallback_smart_scan_still_fills_missing_price() -> None:
    """When there is no extracted price at all, smart scan can still fill it
    even after a body fallback — anything beats no price."""
    result = ScrapeResult()  # no price
    smart = ScrapeResult(price=1500.0, raw_price="Rs 1,500")
    smart_data = _smart_data(
        main_value=1500.0,
        main_text="Rs 1,500",
        used_body_fallback=True,
        score=60,
    )

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=False,
    )

    assert reviewed.price == 1500.0, (
        f"Missing price should always be filled when smart has a candidate; "
        f"got {reviewed.price}"
    )


def test_body_fallback_smart_scan_cannot_replace_existing_dealer_price() -> None:
    """Existing dealer prices must survive a body-fallback smart scan even
    when the smart-scan dealer guess differs by >=1.25x."""
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
    smart_data = _smart_data(
        main_value=42000.0,
        main_text="Rs 42,000",
        used_body_fallback=True,
        score=80,
    )

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=False,
    )

    assert reviewed.dealer_price == 38000.0, (
        f"Existing dealer price must not be replaced by body-fallback smart "
        f"scan; got {reviewed.dealer_price}"
    )


def test_body_fallback_smart_scan_can_still_fill_missing_dealer() -> None:
    """A missing dealer price can still be filled by smart scan (even with
    body fallback) because there is nothing to lose."""
    result = ScrapeResult(price=42000.0, raw_price="Rs 42,000")
    smart = ScrapeResult(
        price=42000.0,
        raw_price="Rs 42,000",
        dealer_price=38000.0,
        raw_dealer="Rs 38,000",
    )
    smart_data = _smart_data(
        main_value=42000.0,
        main_text="Rs 42,000",
        used_body_fallback=True,
        score=80,
    )

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=False,
    )

    assert reviewed.dealer_price == 38000.0


class _NullJsHandle:
    def as_element(self):
        return None

    async def dispose(self) -> None:
        return None


class _DetectorNullPage:
    def __init__(self) -> None:
        self.page_selector_queries: list[str] = []

    async def evaluate_handle(self, _script):
        return _NullJsHandle()

    async def query_selector(self, selector: str):
        self.page_selector_queries.append(selector)
        return object()


def test_detector_null_does_not_fall_back_to_unvalidated_root() -> None:
    """When detector JS runs and returns null, do not use raw class fallback.

    Otherwise a visible-but-price-less ``.summary.entry-summary`` can be
    treated as a strict price scope and block valid custom selectors that
    live outside that node.
    """
    page = _DetectorNullPage()

    root = asyncio.run(_get_product_root(page))  # type: ignore[arg-type]

    assert root is None
    assert page.page_selector_queries == []


def test_in_buy_box_smart_scan_can_still_correct_clearly_wrong_extracted() -> None:
    """When smart scan stayed inside the buy-box (no body fallback), it
    still has authority to correct wildly mis-extracted prices — this is
    the real-sale path that redacted-store / redacted-store rely on."""
    result = ScrapeResult(price=1000.0, raw_price="1000")
    smart = ScrapeResult(price=500.0, raw_price="Rs 500.00")
    smart_data = _smart_data(
        main_value=500.0,
        main_text="Rs 500.00",
        used_body_fallback=False,
        score=80,
    )

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    assert reviewed.price == 500.0
    assert reviewed.review_status == "corrected"


def test_default_smart_scan_payload_treated_as_buy_box() -> None:
    """Older test fixtures that don't set ``used_body_fallback`` must still
    treat smart scan as authoritative — the absent key defaults to in-box."""
    result = ScrapeResult(price=1000.0, raw_price="1000")
    smart = ScrapeResult(price=500.0, raw_price="Rs 500.00")
    smart_data = _smart_data(main_value=500.0, score=80)
    smart_data.pop("used_body_fallback", None)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=False,
        structured_price_locked=True,
    )

    assert reviewed.price == 500.0


def test_smart_scan_matching_extracted_regular_does_not_surface_alternative() -> None:
    """When custom selectors extracted a sale pair and smart scan only saw
    the regular as its main (Woody / WoodMart strike-detection miss), the
    reviewer must not surface the regular as a "switch to" alternative —
    that would make the UI offer a switch to a price the user already has.
    """
    # Mirrors the redacted-store / redacted-store sale-page output: regular + sale both
    # extracted via Woo defaults, smart scan returns only the regular.
    result = ScrapeResult(
        price=275000.0,
        discounted_price=259500.0,
        raw_price="රු 275,000",
        raw_discounted="රු 259,500",
    )
    smart = ScrapeResult(price=275000.0, raw_price="රු 275,000")
    smart_data = _smart_data(
        main_value=275000.0,
        main_text="රු 275,000",
        used_body_fallback=False,
        score=80,
    )

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=True,
        structured_price_locked=False,
        user_locks={"price", "discounted_price"},
    )

    # User-pinned prices stay put.
    assert reviewed.price == 275000.0
    assert reviewed.discounted_price == 259500.0
    # No misleading "Switch to Rs 275,000" alternative — that's the regular
    # we already have.
    assert reviewed.review_alternative_price is None
    assert reviewed.review_alternative_label is None
    assert not any(
        "Smart scan suggests" in note for note in reviewed.review_notes
    ), reviewed.review_notes


def test_smart_scan_disagreement_on_single_price_still_surfaces_alternative() -> None:
    """The note suppression must NOT fire when there's a single locked price
    (no discounted) and smart scan disagrees — that's a real disagreement
    the user may want to see."""
    result = ScrapeResult(price=42000.0, raw_price="Rs 42,000")
    smart = ScrapeResult(price=4200.0, raw_price="Rs 4,200")
    smart_data = _smart_data(main_value=4200.0, score=80)

    reviewed = _review_result_with_smart_scan(
        result,
        smart,
        smart_data,
        has_custom=True,
        structured_price_locked=False,
        user_locks={"price"},
    )

    assert reviewed.price == 42000.0
    assert reviewed.review_alternative_price == 4200.0
    assert reviewed.review_alternative_label == "smart-scan candidate"


def test_platform_default_stock_selector_cannot_weaken_structured_stock() -> None:
    """Broad platform defaults may see stale variant snippets.

    Shopify pages can expose JSON-LD saying every variant is OutOfStock while
    old inventory snippets elsewhere in the DOM still say "1 in stock". The
    default selector may fill unknown stock, but it must not weaken an
    authoritative structured out_of_stock result.
    """
    resolved = _resolve_custom_stock_status(
        "out_of_stock",
        "in_stock",
        platform="shopify",
        stock_selector=PLATFORM_SELECTORS["shopify"]["stock_status"],
    )

    assert resolved == "out_of_stock"


def test_variant_jsonld_stock_blocks_platform_default_stock_override() -> None:
    resolved = _resolve_custom_stock_status(
        "in_stock",
        "out_of_stock",
        platform="woocommerce",
        stock_selector=PLATFORM_SELECTORS["woocommerce"]["stock_status"],
        structured_variant_stock_locked=True,
    )

    assert resolved == "in_stock"


def test_platform_default_stock_selector_can_override_without_variant_lock() -> None:
    resolved = _resolve_custom_stock_status(
        "in_stock",
        "out_of_stock",
        platform="woocommerce",
        stock_selector=PLATFORM_SELECTORS["woocommerce"]["stock_status"],
    )

    assert resolved == "out_of_stock"


def test_platform_default_stock_selector_can_fill_unknown_stock() -> None:
    resolved = _resolve_custom_stock_status(
        "unknown",
        "in_stock",
        platform="shopify",
        stock_selector=PLATFORM_SELECTORS["shopify"]["stock_status"],
    )

    assert resolved == "in_stock"


def test_true_custom_stock_selector_can_override_structured_stock() -> None:
    resolved = _resolve_custom_stock_status(
        "out_of_stock",
        "in_stock",
        platform="shopify",
        stock_selector=".real-current-variant-stock",
    )

    assert resolved == "in_stock"


if __name__ == "__main__":
    tests = [
        test_structured_plain_digit_raw_not_overridden_when_no_other_signal,
        test_body_fallback_smart_scan_cannot_override_structured_price,
        test_body_fallback_smart_scan_cannot_enrich_structured_sale_pair,
        test_body_fallback_smart_scan_still_fills_missing_price,
        test_body_fallback_smart_scan_cannot_replace_existing_dealer_price,
        test_body_fallback_smart_scan_can_still_fill_missing_dealer,
        test_detector_null_does_not_fall_back_to_unvalidated_root,
        test_in_buy_box_smart_scan_can_still_correct_clearly_wrong_extracted,
        test_default_smart_scan_payload_treated_as_buy_box,
        test_smart_scan_matching_extracted_regular_does_not_surface_alternative,
        test_smart_scan_disagreement_on_single_price_still_surfaces_alternative,
        test_platform_default_stock_selector_cannot_weaken_structured_stock,
        test_variant_jsonld_stock_blocks_platform_default_stock_override,
        test_platform_default_stock_selector_can_override_without_variant_lock,
        test_platform_default_stock_selector_can_fill_unknown_stock,
        test_true_custom_stock_selector_can_override_structured_stock,
    ]
    for t in tests:
        t()
        print(f"OK: {t.__name__}")
    print(f"All {len(tests)} tests passed.")

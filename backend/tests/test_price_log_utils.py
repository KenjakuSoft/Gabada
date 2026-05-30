from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.price_log_utils import infer_currency_code  # noqa: E402


def test_infers_lkr_from_rs_raw_price() -> None:
    assert infer_currency_code("Rs. 24,000.00", local_code="LKR", local_symbol="Rs") == "LKR"


def test_infers_usd_from_dollar_when_local_symbol_differs() -> None:
    assert infer_currency_code("$69.00", local_code="LKR", local_symbol="Rs") == "USD"


def test_numeric_raw_falls_back_to_local_currency() -> None:
    assert infer_currency_code("24000", local_code="LKR", local_symbol="Rs") == "LKR"


def test_plain_word_per_is_not_treated_as_currency() -> None:
    # Regression: redacted-store prices like "Rs. 12,500.00 PER ITEM" previously
    # matched the word "PER" as a currency code.
    assert (
        infer_currency_code(
            "Rs. 12,500.00 PER ITEM", local_code="LKR", local_symbol="Rs"
        )
        == "LKR"
    )


def test_lkr_code_wins_even_with_trailing_per_word() -> None:
    assert (
        infer_currency_code("LKR 12,500.00 PER PIECE", local_code="LKR", local_symbol="Rs")
        == "LKR"
    )


def test_non_iso_three_letter_words_ignored() -> None:
    # "USB", "OFF", "PRO" are not currencies; fall back to local.
    assert (
        infer_currency_code("USB OFF PRO", local_code="LKR", local_symbol="Rs") == "LKR"
    )


def test_explicit_iso_code_used_when_no_symbol_present() -> None:
    assert infer_currency_code("USD 50.00", local_code="LKR", local_symbol="Rs") == "USD"

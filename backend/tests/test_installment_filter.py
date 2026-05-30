"""Installment / payment-method price filtering.

Sri Lankan storefronts label the real, payable price "Cash Price",
"Card Price", or "Cash / Card Price", and show a separate financed total
(Koko / EMI / "credit card price"). The filter must drop the financed
variants while keeping the cash/card price the customer actually pays.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scraper.engine import _is_installment_price, _parse_price  # noqa: E402


def test_cash_card_price_is_not_installment() -> None:
    assert _is_installment_price("Cash / Card Price Rs 24,950.00") is False
    assert _is_installment_price("Card Price Rs 24,950.00") is False
    assert _is_installment_price("Cash Price Rs 24,950.00") is False


def test_cash_card_price_parses_to_value() -> None:
    assert _parse_price("Cash / Card Price Rs 24,950.00") == 24950.0


def test_financing_variants_still_filtered() -> None:
    assert _is_installment_price("3 X Rs 9,345.00 with Koko") is True
    assert _is_installment_price("Rs 8,316.67 / month") is True
    assert _is_installment_price("EMI from Rs 2,000") is True
    assert _is_installment_price("Credit Card Price Rs 28,035.00") is True
    assert _parse_price("3 X Rs 9,345.00 with Koko") is None

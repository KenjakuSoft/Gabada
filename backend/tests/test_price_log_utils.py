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

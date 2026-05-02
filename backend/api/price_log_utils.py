from __future__ import annotations

import re
from typing import Optional


_CODE_RE = re.compile(r"\b([A-Z]{3})\b")
_LKR_RE = re.compile(r"(?i)(?:\bLKR\b|\bRs\.?\s|රු\.?)")


def normalize_currency_code(value: Optional[str]) -> Optional[str]:
    code = (value or "").strip().upper()
    return code if len(code) == 3 and code.isalpha() else None


def infer_currency_code(
    *raw_values: Optional[str],
    local_code: Optional[str] = None,
    local_symbol: Optional[str] = None,
) -> Optional[str]:
    local = normalize_currency_code(local_code)
    symbol = (local_symbol or "").strip()
    text = " ".join(str(value) for value in raw_values if value)
    if not text:
        return local

    upper = text.upper()
    for match in _CODE_RE.finditer(upper):
        code = normalize_currency_code(match.group(1))
        if code:
            return code

    if symbol and symbol in text:
        return local
    if _LKR_RE.search(text):
        return "LKR"
    if "€" in text:
        return "EUR"
    if "£" in text:
        return "GBP"
    if "₹" in text:
        return "INR"
    if "¥" in text:
        return "JPY"
    if "$" in text:
        return local if symbol == "$" and local else "USD"

    return local


async def get_settings_currency(db) -> tuple[Optional[str], Optional[str]]:
    try:
        rows = await db.execute_fetchall(
            "SELECT currency_code, currency_symbol FROM settings WHERE id = 1"
        )
    except Exception:
        return None, None
    if not rows:
        return None, None
    return rows[0]["currency_code"], rows[0]["currency_symbol"]

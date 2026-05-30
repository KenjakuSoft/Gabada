from __future__ import annotations

import re
from typing import Optional


_CODE_RE = re.compile(r"\b([A-Z]{3})\b")
_LKR_RE = re.compile(r"(?i)(?:\bLKR\b|\bRs\.?\s|රු\.?)")

# Active ISO 4217 alphabetic currency codes. The price text we scan also
# contains plain words ("PER", "OFF", "USB", "PRO", …), so a bare ``[A-Z]{3}``
# match is not enough — only treat a token as a currency when it is a real
# ISO 4217 code.
_ISO_4217_CODES = frozenset(
    """
    AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND
    BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF
    DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD
    HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW
    KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU
    MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR
    PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD
    SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU
    UZS VED VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL
    """.split()
)


def normalize_currency_code(value: Optional[str]) -> Optional[str]:
    code = (value or "").strip().upper()
    return code if len(code) == 3 and code.isalpha() else None


def _explicit_iso_code(upper: str) -> Optional[str]:
    """Return the first standalone token that is a real ISO 4217 code."""
    for match in _CODE_RE.finditer(upper):
        if match.group(1) in _ISO_4217_CODES:
            return match.group(1)
    return None


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

    # Unambiguous currency symbols win over a bare 3-letter token: real ISO
    # codes such as TRY / ALL / GEL / TOP are also common English words, so a
    # visible "Rs"/"$"/"€" anchor is the more trustworthy signal.
    if symbol and local and symbol in text:
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

    code = _explicit_iso_code(upper)
    if code:
        return code

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

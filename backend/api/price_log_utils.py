from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional


# Currency values are stored with two decimal places. A difference smaller
# than this after rounding is treated as unchanged so sub-cent float noise
# never produces a price_up / price_down event.
_PRICE_CHANGE_TOLERANCE = 0.001


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


def effective_price(
    price: Optional[float], discounted_price: Optional[float]
) -> Optional[float]:
    """Return the price a shopper would pay, preferring a sale price."""
    return discounted_price if discounted_price is not None else price


@dataclass(frozen=True)
class PriceSnapshot:
    """The price/stock fields needed to classify a change."""

    price: Optional[float] = None
    discounted_price: Optional[float] = None
    stock_status: Optional[str] = None

    @property
    def effective_price(self) -> Optional[float]:
        return effective_price(self.price, self.discounted_price)

    @property
    def normalized_stock_status(self) -> str:
        return self.stock_status or "unknown"

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "PriceSnapshot":
        return cls(
            price=row["price"],
            discounted_price=row["discounted_price"],
            stock_status=row["stock_status"],
        )


@dataclass(frozen=True)
class PriceChange:
    """A classified transition between two price snapshots."""

    change_type: str
    price_delta: Optional[float] = None
    previous_price: Optional[float] = None
    previous_stock_status: Optional[str] = None


def compute_price_change(
    current: PriceSnapshot,
    previous: Optional[PriceSnapshot],
) -> PriceChange:
    """Classify how ``current`` differs from ``previous``.

    Shared by scraping, file/API imports, and catalog sync so all ingestion
    paths report changes the same way. A missing previous snapshot is "new".
    If the previous snapshot exists but had no usable price (for example a
    "call for price" page or a stock-only import), the first observed price is
    also "new" rather than a directionless "price_up".
    """
    if previous is None:
        return PriceChange("new")

    previous_effective = previous.effective_price
    current_effective = current.effective_price
    previous_stock = previous.normalized_stock_status
    current_stock = current.normalized_stock_status

    price_delta: Optional[float] = None
    price_changed = False
    first_price = False

    if previous_effective is not None and current_effective is not None:
        delta = round(current_effective - previous_effective, 2)
        if abs(delta) > _PRICE_CHANGE_TOLERANCE:
            price_delta = delta
            price_changed = True
    elif previous_effective is None and current_effective is not None:
        price_changed = True
        first_price = True

    stock_changed = previous_stock != current_stock

    if first_price:
        change_type = "new"
    elif price_changed and stock_changed:
        change_type = "price_and_stock"
    elif price_changed:
        change_type = "price_up" if (price_delta or 0) > 0 else "price_down"
    elif stock_changed:
        if current_stock == "out_of_stock":
            change_type = "stock_out"
        elif current_stock in ("in_stock", "limited"):
            change_type = "stock_in"
        else:
            change_type = "stock_change"
    else:
        change_type = "no_change"

    return PriceChange(
        change_type=change_type,
        price_delta=price_delta,
        previous_price=previous_effective,
        previous_stock_status=previous_stock,
    )

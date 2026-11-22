import re
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, Field

# ── URL scheme guard ──────────────────────────────────────────────────────────
#
# Product/store URLs are stored verbatim and later rendered as <a href> links
# by the web UI, so an imported "javascript:" URL would execute in the app
# origin when clicked. Browsers strip tab/CR/LF anywhere in a URL and trim C0
# controls/spaces at the ends before parsing, so "jav\tascript:x" is a working
# javascript: URL in an href — mirror that cleanup before reading the scheme.

_URL_TAB_NL_RE = re.compile(r"[\t\r\n]")
_URL_SCHEME_RE = re.compile(r"^([A-Za-z][A-Za-z0-9+.\-]*):")
_C0_AND_SPACE = "".join(map(chr, range(0x21)))
_WEB_URL_SCHEMES = frozenset({"http", "https"})


def _url_scheme(value: str) -> str | None:
    cleaned = _URL_TAB_NL_RE.sub("", value.strip(_C0_AND_SPACE))
    match = _URL_SCHEME_RE.match(cleaned)
    return match.group(1).lower() if match else None


def ensure_web_url(value: Any) -> Any:
    """Reject strings that carry an explicit non-web scheme.

    Scheme-less values ("www.store.lk/item") pass through — they render as
    harmless relative links and file imports legitimately produce them.
    None and empty strings pass through untouched.
    """
    if not isinstance(value, str) or not value.strip():
        return value
    scheme = _url_scheme(value)
    if scheme is not None and scheme not in _WEB_URL_SCHEMES:
        raise ValueError(
            f"URL scheme '{scheme}:' is not allowed — use http:// or https://"
        )
    return value


def neutralize_web_url(
    value: str | None, *, allow_api_scheme: bool = False
) -> str | None:
    """Drop-don't-raise variant for URLs that arrive from external systems.

    WooCommerce catalogs and custom JSON feeds supply permalinks and image
    URLs the user never typed; one hostile value must not fail a whole
    import, so unsafe URLs become None instead of raising.
    ``allow_api_scheme`` keeps the internal ``api://catalog/...`` sentinel
    used for API-only products that have no web page.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    scheme = _url_scheme(value)
    if scheme is None or scheme in _WEB_URL_SCHEMES:
        return value
    if allow_api_scheme and scheme == "api":
        return value
    return None


WebUrl = Annotated[str, BeforeValidator(ensure_web_url)]
"""A str field that rejects explicit non-http(s) schemes at validation time."""


# ── Categories ────────────────────────────────────────────────────────────────

class CategoryCreate(BaseModel):
    name: str
    color: str = "#6C63FF"

class Category(CategoryCreate):
    id: int
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Stores ────────────────────────────────────────────────────────────────────

class StoreCreate(BaseModel):
    name: str
    base_url: WebUrl = ""
    manual_only: bool = False
    login_url: WebUrl | None = None
    woo_enabled: bool = False
    woo_site_url: WebUrl | None = None
    woo_consumer_key: str | None = None
    woo_consumer_secret: str | None = None
    woo_auto_import_new: bool = False
    api_enabled: bool = False
    api_platform: str | None = None
    api_base_url: WebUrl | None = None
    api_key: str | None = None
    api_config: dict[str, Any] = Field(default_factory=dict)
    api_auto_import_new: bool = False


class StoreUpdate(BaseModel):
    name: str | None = None
    base_url: WebUrl | None = None
    manual_only: bool | None = None
    login_url: WebUrl | None = None
    storage_state_path: str | None = None
    woo_enabled: bool | None = None
    woo_site_url: WebUrl | None = None
    woo_consumer_key: str | None = None
    woo_consumer_secret: str | None = None
    woo_auto_import_new: bool | None = None
    api_enabled: bool | None = None
    api_platform: str | None = None
    api_base_url: WebUrl | None = None
    api_key: str | None = None
    api_config: dict[str, Any] | None = None
    api_auto_import_new: bool | None = None

class Store(StoreCreate):
    id: int
    # Output model: rows written before the WebUrl guard existed may hold
    # values the validator would reject — never fail a read over stored data.
    base_url: str = ""
    login_url: str | None = None
    woo_site_url: str | None = None
    api_base_url: str | None = None
    storage_state_path: str | None = None
    session_updated_at: datetime | None = None
    created_at: datetime
    woo_last_synced_at: datetime | None = None
    api_last_synced_at: datetime | None = None
    model_config = {"from_attributes": True}


class StoreLoginSessionRequest(BaseModel):
    wait_seconds: int = 180
    headless: bool = False


class StoreLoginSessionResponse(BaseModel):
    store: Store
    saved_to: str
    final_url: str


class WooSyncResult(BaseModel):
    store_id: int
    store_name: str
    discovered: int = 0
    created: int = 0
    existing: int = 0
    auto_import_new: bool = False
    synced_at: datetime | None = None


class ApiSyncResult(BaseModel):
    store_id: int
    store_name: str
    platform: str
    discovered: int = 0
    created: int = 0
    existing: int = 0
    updated: int = 0
    auto_import_new: bool = False
    synced_at: datetime | None = None


# ── Scrape config ─────────────────────────────────────────────────────────────

class ScrapeSelectors(BaseModel):
    title: str | None = None
    price: str | None = None
    discounted_price: str | None = None
    dealer_price: str | None = None
    stock_status: str | None = None
    image: str | None = None

_BUY_AREA_TARGET_FIELDS = (
    "price",
    "discounted_price",
    "dealer_price",
    "stock_status",
    "title",
)


class BuyAreaPick(BaseModel):
    """A user's "track THIS specific buy-area item" mapping for one field.

    Phase 2 of the self-adaptive scraper: instead of relying on a global
    selector, the user picks one ``BuyAreaItem`` from the Selector Lab and
    tells Gabada to use it as the ``target_field`` value on every future
    scrape. The fingerprint fields are matched against the live buy-area
    dump at replay time so the pick survives minor template churn.

    Persisted inside ``ScrapeConfig.buy_area_picks`` and replayed by the
    engine after the existing extraction waterfall.
    """

    target_field: str  # one of _BUY_AREA_TARGET_FIELDS
    selector: str | None = None
    dom_path: str | None = None
    kind: str = "price"
    text: str = ""
    value: float | None = None
    qualifier: str | None = None
    label_before: str | None = None
    label_after: str | None = None
    # Recorded for the user's reference; not used for matching.
    picked_at: datetime | None = None


class ScrapeConfig(BaseModel):
    use_playwright: bool = True
    wait_for: str | None = None
    wait_timeout: int = 15000
    selectors: ScrapeSelectors = ScrapeSelectors()
    # Authenticated / customised scraping
    cookies: list[dict[str, Any]] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    storage_state_path: str | None = None
    # Hint from platform auto-detection, e.g. "cs-cart", "woocommerce", "shopify"
    platform: str | None = None
    # User-pinned buy-area items. Engine replays these after the waterfall
    # to override ``target_field`` with the matching live item. At most one
    # pick per ``target_field``; later writes for the same field overwrite.
    buy_area_picks: list[BuyAreaPick] = Field(default_factory=list)


# ── Manual override ───────────────────────────────────────────────────────────

class ProductStoreOverrideUpsert(BaseModel):
    manual_price: float | None = None
    manual_stock_status: str | None = None
    manual_warranty: str | None = None
    override_note: str | None = None

class ProductStoreOverride(ProductStoreOverrideUpsert):
    id: int
    product_store_id: int
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Products ──────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    canonical_name: str
    image_url: WebUrl | None = None
    category_id: int | None = None

class ProductStoreCreate(BaseModel):
    store_id: int
    product_url: WebUrl | None = None
    scrape_config: ScrapeConfig = ScrapeConfig()
    # Probe the URL and auto-fill wait_for + selectors based on detected
    # platform. Any fields already set in scrape_config are preserved.
    auto_detect: bool = True

class ProductStoreUpdate(BaseModel):
    product_url: WebUrl | None = None
    clear_logs_on_url_change: bool = False
    manual_price: float | None = None
    manual_stock_status: str | None = None
    manual_warranty: str | None = None
    override_note: str | None = None

class ProductStoreSummary(BaseModel):
    id: int
    store_id: int
    store_name: str
    store_base_url: str
    store_manual_only: bool = False
    product_url: str
    is_active: bool
    latest_price: float | None = None
    latest_discounted_price: float | None = None
    latest_dealer_price: float | None = None
    latest_warranty: str | None = None
    latest_stock_status: str | None = None
    latest_raw_price: str | None = None
    latest_raw_discounted: str | None = None
    latest_raw_dealer: str | None = None
    latest_currency_code: str | None = None
    latest_scraped_at: datetime | None = None
    latest_change_type: str | None = None
    latest_price_delta: float | None = None
    manual_price: float | None = None
    manual_stock_status: str | None = None
    manual_warranty: str | None = None
    override_note: str | None = None

    model_config = {"from_attributes": True}

class Product(BaseModel):
    id: int
    canonical_name: str
    image_url: str | None = None
    category_id: int | None = None
    category_name: str | None = None
    category_color: str | None = None
    created_at: datetime
    stores: list[ProductStoreSummary] = []

    model_config = {"from_attributes": True}


# ── Price logs ────────────────────────────────────────────────────────────────

class PriceLog(BaseModel):
    id: int
    product_store_id: int
    scraped_at: datetime
    title: str | None = None
    price: float | None = None
    discounted_price: float | None = None
    dealer_price: float | None = None
    warranty: str | None = None
    stock_status: str | None = None
    raw_price: str | None = None
    raw_discounted: str | None = None
    raw_dealer: str | None = None
    currency_code: str | None = None
    change_type: str | None = None
    price_delta: float | None = None
    previous_price: float | None = None
    previous_stock_status: str | None = None

    model_config = {"from_attributes": True}


class ActivityEntry(BaseModel):
    id: int
    product_id: int
    product_name: str
    store_id: int
    store_name: str
    change_type: str
    price: float | None = None
    discounted_price: float | None = None
    dealer_price: float | None = None
    raw_price: str | None = None
    raw_discounted: str | None = None
    raw_dealer: str | None = None
    currency_code: str | None = None
    price_delta: float | None = None
    previous_price: float | None = None
    stock_status: str | None = None
    previous_stock_status: str | None = None
    scraped_at: datetime

    model_config = {"from_attributes": True}


# ── Scrape result (internal) ──────────────────────────────────────────────────

class ScrapeResult(BaseModel):
    title: str | None = None
    price: float | None = None
    discounted_price: float | None = None
    dealer_price: float | None = None
    stock_status: str = "unknown"
    raw_price: str | None = None
    raw_discounted: str | None = None
    raw_dealer: str | None = None
    review_status: str = "ok"
    review_notes: list[str] = Field(default_factory=list)
    # When the price-review step keeps one price over a competing candidate,
    # surface the rejected candidate so the UI can offer a manual choice.
    review_alternative_price: float | None = None
    review_alternative_raw: str | None = None
    review_alternative_label: str | None = None
    error: str | None = None


# ── WooCommerce import ────────────────────────────────────────────────────────

class WooCredentials(BaseModel):
    site_url: WebUrl
    consumer_key: str
    consumer_secret: str

class WooProductPreview(BaseModel):
    woo_id: int
    name: str
    permalink: str
    regular_price: str | None = None
    sale_price: str | None = None
    stock_status: str = "unknown"
    image_url: str | None = None
    categories: list[str] = []

class WooPreviewRequest(BaseModel):
    credentials: WooCredentials
    per_page: int = 50
    page: int = 1
    fetch_all: bool = False

class WooImportRequest(BaseModel):
    credentials: WooCredentials
    store_id: int
    product_ids: list[int]


# Generic API catalog import

class ApiProductPreview(BaseModel):
    platform: str
    external_id: str
    name: str
    permalink: str
    price: float | None = None
    discounted_price: float | None = None
    currency: str | None = None
    raw_price: str | None = None
    raw_discounted: str | None = None
    stock_status: str = "unknown"
    image_url: str | None = None
    categories: list[str] = []


class ApiPreviewRequest(BaseModel):
    platform: str = "steam"
    query: str | None = None
    external_ids: list[str] = Field(default_factory=list)
    country_code: str | None = "US"
    language: str | None = "english"
    limit: int = 25
    base_url: WebUrl | None = None
    api_key: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class ApiImportRequest(BaseModel):
    platform: str = "steam"
    store_id: int
    external_ids: list[str]
    country_code: str | None = "US"
    language: str | None = "english"
    base_url: WebUrl | None = None
    api_key: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


# ── File import ───────────────────────────────────────────────────────────────

class FileImportPreviewResponse(BaseModel):
    columns: list[str]
    sample_rows: list[list[str]]
    rows: list[list[str]] = Field(default_factory=list)
    total_rows: int
    file_format: str  # "csv", "excel", "pdf"
    source_name: str | None = None

class FileImportRow(BaseModel):
    name: str
    source_index: int | None = None
    product_id: int | None = None
    product_store_id: int | None = None
    url: WebUrl | None = None
    image_url: WebUrl | None = None
    price: str | float | None = None
    discounted_price: str | float | None = None
    dealer_price: str | float | None = None
    warranty: str | None = None
    stock_status: str | None = None

class FileImportCommitRequest(BaseModel):
    rows: list[FileImportRow]
    store_id: int
    category_id: int | None = None
    create_missing_products: bool = True
    missing_rows_policy: str = "ignore"
    full_catalog_seen_product_store_ids: list[int] = Field(default_factory=list)
    dealer_column_mapped: bool = False
    warranty_column_mapped: bool = False


class FileImportCommitResponse(BaseModel):
    imported: int
    created: int = 0
    updated: int = 0
    skipped: int = 0
    dealer_unavailable_marked: int = 0


# ── Quick-add (paste URLs → tracked products) ────────────────────────────────

class QuickAddRequest(BaseModel):
    urls: list[WebUrl]
    category_id: int | None = None
    store_id: int | None = None


class QuickAddResult(BaseModel):
    url: str
    status: str  # "ok" | "error"
    product_id: int | None = None
    product_store_id: int | None = None
    name: str | None = None
    store_id: int | None = None
    store_name: str | None = None
    platform: str | None = None
    price: float | None = None
    discounted_price: float | None = None
    stock_status: str | None = None
    error: str | None = None


class QuickAddResponse(BaseModel):
    results: list[QuickAddResult]


# ── Probe / diagnostics ───────────────────────────────────────────────────────

class ProbeCandidate(BaseModel):
    text: str
    value: float | None = None
    score: int = 0
    font_size: float | None = None
    font_weight: int | None = None
    struck: bool = False
    dealer: bool = False
    variant_alt: bool = False
    dom_path: str | None = None


class BuyAreaItem(BaseModel):
    """One visible item inside the detected product buy-box.

    The scraper used to project every product page onto a fixed schema
    (price / discounted_price / dealer_price / stock_status), which broke
    on storefronts that surface qualifiers like "Free with PS Plus",
    "Game Trial", "Included", or "Coming Soon" — none of which fit a
    numeric price slot. ``BuyAreaItem`` captures the buy-area as it
    actually appears so the user can decide what to track per store.

    ``value`` is intentionally optional: a ``kind="price"`` item with
    ``value=None`` represents a non-numeric price (free, included, etc.)
    where the human-readable text lives in ``text`` / ``qualifier``.
    """

    # Best-guess role of the item in the buy area.
    #
    #   "title"     — product title heading
    #   "price"     — a number (or "Free" / "Included" qualifier in the
    #                 price slot — see ``value``)
    #   "qualifier" — text that modifies a nearby price (e.g. "with PS Plus",
    #                 "Game Trial", "Subscriber price", "Trial")
    #   "badge"     — sale stickers and promo callouts (-40%, "SALE", "NEW")
    #   "label"     — short text near a price that names what the price is
    #                 for (edition name, variant, region)
    #   "stock"     — add-to-cart / buy-now / out-of-stock controls
    #   "image"     — product image URL
    #   "other"     — visible text that didn't classify cleanly
    kind: str
    text: str
    value: float | None = None
    qualifier: str | None = None
    selector: str | None = None
    dom_path: str | None = None
    tag: str | None = None
    struck: bool = False
    is_button: bool = False
    is_disabled: bool = False
    font_size: float | None = None
    font_weight: int | None = None
    # Visual / DOM-order index inside the buy area, useful for replaying
    # a saved user mapping when selectors rotate.
    order: int = 0
    label_before: str | None = None
    label_after: str | None = None
    near_badges: list[str] = Field(default_factory=list)
    near_price: str | None = None


class ProbeResponse(BaseModel):
    url: str
    final_url: str | None = None
    platform: str = "generic"
    suggested_wait_for: str | None = None
    suggested_selectors: dict[str, str | None] = Field(default_factory=dict)
    json_ld_found: bool = False
    json_ld_name: str | None = None
    json_ld_price: float | None = None
    json_ld_availability: str | None = None
    extracted: ScrapeResult = ScrapeResult()
    candidates: list[ProbeCandidate] = Field(default_factory=list)
    buy_area: list[BuyAreaItem] = Field(default_factory=list)
    buy_area_root: str | None = None
    notes: list[str] = Field(default_factory=list)


class SelectorLabCandidate(BaseModel):
    selector: str
    dom_path: str | None = None
    text: str | None = None
    sample: str | None = None
    value: float | None = None
    stock_status: str | None = None
    tag: str | None = None
    source: str = "dom"
    confidence: int = 0
    kind_hints: list[str] = Field(default_factory=list)
    reason: str | None = None


class SelectorLabProfile(BaseModel):
    hostname: str
    matched_hostname: str | None = None
    platform: str | None = None
    wait_for: str | None = None
    selectors: dict[str, str | None] = Field(default_factory=dict)


class SelectorLabResponse(BaseModel):
    url: str
    final_url: str | None = None
    hostname: str | None = None
    platform: str = "generic"
    # True when the page's buy area carries installment / pay-later amounts
    # (KOKO, Mintpay, ...) near the real price — the UI defaults its
    # candidate list to "helpful only" on such pages.
    noisy_price_context: bool = False
    root_selector: str | None = None
    extracted: ScrapeResult = ScrapeResult()
    current_profile: SelectorLabProfile | None = None
    suggested_assignments: dict[str, str | None] = Field(default_factory=dict)
    candidates: list[SelectorLabCandidate] = Field(default_factory=list)
    buy_area: list[BuyAreaItem] = Field(default_factory=list)
    buy_area_root: str | None = None
    notes: list[str] = Field(default_factory=list)


class ProbeRequest(BaseModel):
    url: str
    use_playwright: bool = True
    wait_for: str | None = None
    wait_timeout: int = 15000
    cookies: list[dict[str, Any]] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    storage_state_path: str | None = None


class SelectorLabRequest(BaseModel):
    url: str
    use_playwright: bool = True
    wait_for: str | None = None
    wait_timeout: int = 15000
    cookies: list[dict[str, Any]] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    storage_state_path: str | None = None


class SelectorLabTestRequest(SelectorLabRequest):
    platform: str | None = None
    selectors: dict[str, str | None] = Field(default_factory=dict)
    # Live buy-area picks the user has staged in the Selector Lab UI.
    # Passed through to the test scrape so the test reflects what the next
    # real scrape would produce, without requiring the user to save first.
    buy_area_picks: list[BuyAreaPick] = Field(default_factory=list)


class SelectorLabSaveRequest(BaseModel):
    url: str | None = None
    store_id: int | None = None
    hostname: str | None = None
    platform: str | None = None
    wait_for: str | None = None
    selectors: dict[str, str | None] = Field(default_factory=dict)


class SelectorLabSaveResponse(BaseModel):
    profile: SelectorLabProfile
    path: str
    hostnames: list[str] = Field(default_factory=list)


class BuyAreaPickRequest(BaseModel):
    """Request body for upserting a buy-area pick on a product_store.

    The ``pick.target_field`` value identifies which schema slot the user
    is mapping (price / discounted_price / dealer_price / stock_status /
    title). Saving a second pick with the same ``target_field`` overwrites
    the previous one.
    """
    product_store_id: int
    pick: BuyAreaPick


class BuyAreaPicksResponse(BaseModel):
    """Current set of buy-area picks pinned to a product_store."""
    product_store_id: int
    picks: list[BuyAreaPick] = Field(default_factory=list)


class LoginSessionRequest(BaseModel):
    url: str
    save_path: str  # absolute or relative path where storage_state.json will be written
    headless: bool = False
    wait_seconds: int = 180  # how long to keep browser open for manual login


# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseModel):
    currency_code: str = "USD"
    currency_symbol: str = "$"
    country_code: str = "US"
    timezone: str = "UTC"
    scrape_cron: str = "0 8 * * *"
    scrape_enabled: bool = True
    locale: str = "en-US"
    price_display_mode: str = "regional"  # "regional" | "source"
    exchange_rates: dict[str, float] = Field(default_factory=dict)
    theme: str = "system"  # "light" | "dark" | "system"
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    currency_code: str | None = None
    currency_symbol: str | None = None
    country_code: str | None = None
    timezone: str | None = None
    scrape_cron: str | None = None
    scrape_enabled: bool | None = None
    locale: str | None = None
    price_display_mode: str | None = None
    exchange_rates: dict[str, float] | None = None
    theme: str | None = None


class DatabaseCounts(BaseModel):
    products: int = 0
    stores: int = 0
    categories: int = 0
    product_stores: int = 0
    price_logs: int = 0


class DatabaseTransferInfo(BaseModel):
    data_dir: str
    database_path: str
    site_profiles_path: str
    site_profiles_exists: bool
    install_mode: str
    recommended_export_name: str
    counts: DatabaseCounts = DatabaseCounts()
    database_modified_at: datetime | None = None


class DatabaseImportResponse(BaseModel):
    source_name: str
    backup_path: str
    site_profiles_restored: bool = False
    counts: DatabaseCounts = DatabaseCounts()


# ── Updates ───────────────────────────────────────────────────────────────────

class UpdateAsset(BaseModel):
    name: str
    browser_download_url: str
    size: int | None = None
    kind: str = "other"
    platform: str | None = None
    arch: str | None = None


class UpdateCheckResponse(BaseModel):
    current_version: str
    latest_version: str | None = None
    update_available: bool = False
    release_url: str | None = None
    release_name: str | None = None
    published_at: datetime | None = None
    install_mode: str = "source"
    platform: str
    arch: str
    recommended_asset: UpdateAsset | None = None
    assets: list[UpdateAsset] = []
    error: str | None = None


# ── Drive sync ────────────────────────────────────────────────────────────────


class DriveCredentialsRequest(BaseModel):
    client_id: str
    client_secret: str


class DriveAuthStartResponse(BaseModel):
    auth_url: str


class DriveStatus(BaseModel):
    configured: bool = False  # client_id + secret saved
    signed_in: bool = False
    account_email: str | None = None
    auth_in_progress: bool = False
    last_push_at: datetime | None = None
    last_push_name: str | None = None


class DriveSnapshot(BaseModel):
    id: str
    name: str
    size: int | None = None
    created_time: datetime | None = None
    modified_time: datetime | None = None


class DriveSnapshotList(BaseModel):
    snapshots: list[DriveSnapshot] = []


class DrivePushResponse(BaseModel):
    snapshot: DriveSnapshot
    pruned: int = 0
    counts: DatabaseCounts = DatabaseCounts()


class DriveRestoreResponse(BaseModel):
    snapshot_id: str
    snapshot_name: str
    backup_path: str
    site_profiles_restored: bool = False
    counts: DatabaseCounts = DatabaseCounts()

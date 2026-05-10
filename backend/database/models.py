from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


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
    base_url: str = ""
    manual_only: bool = False
    login_url: Optional[str] = None
    woo_enabled: bool = False
    woo_site_url: Optional[str] = None
    woo_consumer_key: Optional[str] = None
    woo_consumer_secret: Optional[str] = None
    woo_auto_import_new: bool = False
    api_enabled: bool = False
    api_platform: Optional[str] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    api_config: dict[str, Any] = Field(default_factory=dict)
    api_auto_import_new: bool = False


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    manual_only: Optional[bool] = None
    login_url: Optional[str] = None
    storage_state_path: Optional[str] = None
    woo_enabled: Optional[bool] = None
    woo_site_url: Optional[str] = None
    woo_consumer_key: Optional[str] = None
    woo_consumer_secret: Optional[str] = None
    woo_auto_import_new: Optional[bool] = None
    api_enabled: Optional[bool] = None
    api_platform: Optional[str] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    api_config: Optional[dict[str, Any]] = None
    api_auto_import_new: Optional[bool] = None

class Store(StoreCreate):
    id: int
    storage_state_path: Optional[str] = None
    session_updated_at: Optional[datetime] = None
    created_at: datetime
    woo_last_synced_at: Optional[datetime] = None
    api_last_synced_at: Optional[datetime] = None
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
    synced_at: Optional[datetime] = None


class ApiSyncResult(BaseModel):
    store_id: int
    store_name: str
    platform: str
    discovered: int = 0
    created: int = 0
    existing: int = 0
    updated: int = 0
    auto_import_new: bool = False
    synced_at: Optional[datetime] = None


# ── Scrape config ─────────────────────────────────────────────────────────────

class ScrapeSelectors(BaseModel):
    title: Optional[str] = None
    price: Optional[str] = None
    discounted_price: Optional[str] = None
    dealer_price: Optional[str] = None
    stock_status: Optional[str] = None
    image: Optional[str] = None

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
    selector: Optional[str] = None
    dom_path: Optional[str] = None
    kind: str = "price"
    text: str = ""
    value: Optional[float] = None
    qualifier: Optional[str] = None
    label_before: Optional[str] = None
    label_after: Optional[str] = None
    # Recorded for the user's reference; not used for matching.
    picked_at: Optional[datetime] = None


class ScrapeConfig(BaseModel):
    use_playwright: bool = True
    wait_for: Optional[str] = None
    wait_timeout: int = 15000
    selectors: ScrapeSelectors = ScrapeSelectors()
    # Authenticated / customised scraping
    cookies: list[dict[str, Any]] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    storage_state_path: Optional[str] = None
    # Hint from platform auto-detection, e.g. "cs-cart", "woocommerce", "shopify"
    platform: Optional[str] = None
    # User-pinned buy-area items. Engine replays these after the waterfall
    # to override ``target_field`` with the matching live item. At most one
    # pick per ``target_field``; later writes for the same field overwrite.
    buy_area_picks: list[BuyAreaPick] = Field(default_factory=list)


# ── Manual override ───────────────────────────────────────────────────────────

class ProductStoreOverrideUpsert(BaseModel):
    manual_price: Optional[float] = None
    manual_stock_status: Optional[str] = None
    manual_warranty: Optional[str] = None
    override_note: Optional[str] = None

class ProductStoreOverride(ProductStoreOverrideUpsert):
    id: int
    product_store_id: int
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Products ──────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    canonical_name: str
    image_url: Optional[str] = None
    category_id: Optional[int] = None

class ProductStoreCreate(BaseModel):
    store_id: int
    product_url: Optional[str] = None
    scrape_config: ScrapeConfig = ScrapeConfig()
    # Probe the URL and auto-fill wait_for + selectors based on detected
    # platform. Any fields already set in scrape_config are preserved.
    auto_detect: bool = True

class ProductStoreUpdate(BaseModel):
    product_url: Optional[str] = None
    clear_logs_on_url_change: bool = False
    manual_price: Optional[float] = None
    manual_stock_status: Optional[str] = None
    manual_warranty: Optional[str] = None
    override_note: Optional[str] = None

class ProductStoreSummary(BaseModel):
    id: int
    store_id: int
    store_name: str
    store_base_url: str
    store_manual_only: bool = False
    product_url: str
    is_active: bool
    latest_price: Optional[float] = None
    latest_discounted_price: Optional[float] = None
    latest_dealer_price: Optional[float] = None
    latest_warranty: Optional[str] = None
    latest_stock_status: Optional[str] = None
    latest_raw_price: Optional[str] = None
    latest_raw_discounted: Optional[str] = None
    latest_raw_dealer: Optional[str] = None
    latest_currency_code: Optional[str] = None
    latest_scraped_at: Optional[datetime] = None
    latest_change_type: Optional[str] = None
    latest_price_delta: Optional[float] = None
    manual_price: Optional[float] = None
    manual_stock_status: Optional[str] = None
    manual_warranty: Optional[str] = None
    override_note: Optional[str] = None

    model_config = {"from_attributes": True}

class Product(BaseModel):
    id: int
    canonical_name: str
    image_url: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    created_at: datetime
    stores: list[ProductStoreSummary] = []

    model_config = {"from_attributes": True}


# ── Price logs ────────────────────────────────────────────────────────────────

class PriceLog(BaseModel):
    id: int
    product_store_id: int
    scraped_at: datetime
    title: Optional[str] = None
    price: Optional[float] = None
    discounted_price: Optional[float] = None
    dealer_price: Optional[float] = None
    warranty: Optional[str] = None
    stock_status: Optional[str] = None
    raw_price: Optional[str] = None
    raw_discounted: Optional[str] = None
    raw_dealer: Optional[str] = None
    currency_code: Optional[str] = None
    change_type: Optional[str] = None
    price_delta: Optional[float] = None
    previous_price: Optional[float] = None
    previous_stock_status: Optional[str] = None

    model_config = {"from_attributes": True}


class ActivityEntry(BaseModel):
    id: int
    product_id: int
    product_name: str
    store_id: int
    store_name: str
    change_type: str
    price: Optional[float] = None
    discounted_price: Optional[float] = None
    dealer_price: Optional[float] = None
    raw_price: Optional[str] = None
    raw_discounted: Optional[str] = None
    raw_dealer: Optional[str] = None
    currency_code: Optional[str] = None
    price_delta: Optional[float] = None
    previous_price: Optional[float] = None
    stock_status: Optional[str] = None
    previous_stock_status: Optional[str] = None
    scraped_at: datetime

    model_config = {"from_attributes": True}


# ── Scrape result (internal) ──────────────────────────────────────────────────

class ScrapeResult(BaseModel):
    title: Optional[str] = None
    price: Optional[float] = None
    discounted_price: Optional[float] = None
    dealer_price: Optional[float] = None
    stock_status: str = "unknown"
    raw_price: Optional[str] = None
    raw_discounted: Optional[str] = None
    raw_dealer: Optional[str] = None
    review_status: str = "ok"
    review_notes: list[str] = Field(default_factory=list)
    # When the price-review step keeps one price over a competing candidate,
    # surface the rejected candidate so the UI can offer a manual choice.
    review_alternative_price: Optional[float] = None
    review_alternative_raw: Optional[str] = None
    review_alternative_label: Optional[str] = None
    error: Optional[str] = None


# ── WooCommerce import ────────────────────────────────────────────────────────

class WooCredentials(BaseModel):
    site_url: str
    consumer_key: str
    consumer_secret: str

class WooProductPreview(BaseModel):
    woo_id: int
    name: str
    permalink: str
    regular_price: Optional[str] = None
    sale_price: Optional[str] = None
    stock_status: str = "unknown"
    image_url: Optional[str] = None
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
    price: Optional[float] = None
    discounted_price: Optional[float] = None
    currency: Optional[str] = None
    raw_price: Optional[str] = None
    raw_discounted: Optional[str] = None
    stock_status: str = "unknown"
    image_url: Optional[str] = None
    categories: list[str] = []


class ApiPreviewRequest(BaseModel):
    platform: str = "steam"
    query: Optional[str] = None
    external_ids: list[str] = Field(default_factory=list)
    country_code: Optional[str] = "US"
    language: Optional[str] = "english"
    limit: int = 25
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    config: dict[str, Any] = Field(default_factory=dict)


class ApiImportRequest(BaseModel):
    platform: str = "steam"
    store_id: int
    external_ids: list[str]
    country_code: Optional[str] = "US"
    language: Optional[str] = "english"
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    config: dict[str, Any] = Field(default_factory=dict)


# ── File import ───────────────────────────────────────────────────────────────

class FileImportPreviewResponse(BaseModel):
    columns: list[str]
    sample_rows: list[list[str]]
    rows: list[list[str]] = Field(default_factory=list)
    total_rows: int
    file_format: str  # "csv", "excel", "pdf"
    source_name: Optional[str] = None

class FileImportRow(BaseModel):
    name: str
    source_index: Optional[int] = None
    product_id: Optional[int] = None
    product_store_id: Optional[int] = None
    url: Optional[str] = None
    image_url: Optional[str] = None
    price: Optional[str | float] = None
    discounted_price: Optional[str | float] = None
    dealer_price: Optional[str | float] = None
    warranty: Optional[str] = None
    stock_status: Optional[str] = None

class FileImportCommitRequest(BaseModel):
    rows: list[FileImportRow]
    store_id: int
    category_id: Optional[int] = None
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
    urls: list[str]
    category_id: Optional[int] = None
    store_id: Optional[int] = None


class QuickAddResult(BaseModel):
    url: str
    status: str  # "ok" | "error"
    product_id: Optional[int] = None
    product_store_id: Optional[int] = None
    name: Optional[str] = None
    store_id: Optional[int] = None
    store_name: Optional[str] = None
    platform: Optional[str] = None
    price: Optional[float] = None
    discounted_price: Optional[float] = None
    stock_status: Optional[str] = None
    error: Optional[str] = None


class QuickAddResponse(BaseModel):
    results: list[QuickAddResult]


# ── Probe / diagnostics ───────────────────────────────────────────────────────

class ProbeCandidate(BaseModel):
    text: str
    value: Optional[float] = None
    score: int = 0
    font_size: Optional[float] = None
    font_weight: Optional[int] = None
    struck: bool = False
    dealer: bool = False
    variant_alt: bool = False
    dom_path: Optional[str] = None


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
    value: Optional[float] = None
    qualifier: Optional[str] = None
    selector: Optional[str] = None
    dom_path: Optional[str] = None
    tag: Optional[str] = None
    struck: bool = False
    is_button: bool = False
    is_disabled: bool = False
    font_size: Optional[float] = None
    font_weight: Optional[int] = None
    # Visual / DOM-order index inside the buy area, useful for replaying
    # a saved user mapping when selectors rotate.
    order: int = 0
    label_before: Optional[str] = None
    label_after: Optional[str] = None
    near_badges: list[str] = Field(default_factory=list)
    near_price: Optional[str] = None


class ProbeResponse(BaseModel):
    url: str
    final_url: Optional[str] = None
    platform: str = "generic"
    suggested_wait_for: Optional[str] = None
    suggested_selectors: dict[str, Optional[str]] = Field(default_factory=dict)
    json_ld_found: bool = False
    json_ld_name: Optional[str] = None
    json_ld_price: Optional[float] = None
    json_ld_availability: Optional[str] = None
    extracted: ScrapeResult = ScrapeResult()
    candidates: list[ProbeCandidate] = Field(default_factory=list)
    buy_area: list[BuyAreaItem] = Field(default_factory=list)
    buy_area_root: Optional[str] = None
    notes: list[str] = Field(default_factory=list)


class SelectorLabCandidate(BaseModel):
    selector: str
    dom_path: Optional[str] = None
    text: Optional[str] = None
    sample: Optional[str] = None
    value: Optional[float] = None
    stock_status: Optional[str] = None
    tag: Optional[str] = None
    source: str = "dom"
    confidence: int = 0
    kind_hints: list[str] = Field(default_factory=list)
    reason: Optional[str] = None


class SelectorLabProfile(BaseModel):
    hostname: str
    matched_hostname: Optional[str] = None
    platform: Optional[str] = None
    wait_for: Optional[str] = None
    selectors: dict[str, Optional[str]] = Field(default_factory=dict)


class SelectorLabResponse(BaseModel):
    url: str
    final_url: Optional[str] = None
    hostname: Optional[str] = None
    platform: str = "generic"
    root_selector: Optional[str] = None
    extracted: ScrapeResult = ScrapeResult()
    current_profile: Optional[SelectorLabProfile] = None
    suggested_assignments: dict[str, Optional[str]] = Field(default_factory=dict)
    candidates: list[SelectorLabCandidate] = Field(default_factory=list)
    buy_area: list[BuyAreaItem] = Field(default_factory=list)
    buy_area_root: Optional[str] = None
    notes: list[str] = Field(default_factory=list)


class ProbeRequest(BaseModel):
    url: str
    use_playwright: bool = True
    wait_for: Optional[str] = None
    wait_timeout: int = 15000
    cookies: list[dict[str, Any]] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    storage_state_path: Optional[str] = None


class SelectorLabRequest(BaseModel):
    url: str
    use_playwright: bool = True
    wait_for: Optional[str] = None
    wait_timeout: int = 15000
    cookies: list[dict[str, Any]] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    storage_state_path: Optional[str] = None


class SelectorLabTestRequest(SelectorLabRequest):
    platform: Optional[str] = None
    selectors: dict[str, Optional[str]] = Field(default_factory=dict)
    # Live buy-area picks the user has staged in the Selector Lab UI.
    # Passed through to the test scrape so the test reflects what the next
    # real scrape would produce, without requiring the user to save first.
    buy_area_picks: list[BuyAreaPick] = Field(default_factory=list)


class SelectorLabSaveRequest(BaseModel):
    url: Optional[str] = None
    store_id: Optional[int] = None
    hostname: Optional[str] = None
    platform: Optional[str] = None
    wait_for: Optional[str] = None
    selectors: dict[str, Optional[str]] = Field(default_factory=dict)


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
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    currency_code: Optional[str] = None
    currency_symbol: Optional[str] = None
    country_code: Optional[str] = None
    timezone: Optional[str] = None
    scrape_cron: Optional[str] = None
    scrape_enabled: Optional[bool] = None
    locale: Optional[str] = None
    price_display_mode: Optional[str] = None
    exchange_rates: Optional[dict[str, float]] = None
    theme: Optional[str] = None


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
    database_modified_at: Optional[datetime] = None


class DatabaseImportResponse(BaseModel):
    source_name: str
    backup_path: str
    site_profiles_restored: bool = False
    counts: DatabaseCounts = DatabaseCounts()


# ── Updates ───────────────────────────────────────────────────────────────────

class UpdateAsset(BaseModel):
    name: str
    browser_download_url: str
    size: Optional[int] = None
    kind: str = "other"
    platform: Optional[str] = None
    arch: Optional[str] = None


class UpdateCheckResponse(BaseModel):
    current_version: str
    latest_version: Optional[str] = None
    update_available: bool = False
    release_url: Optional[str] = None
    release_name: Optional[str] = None
    published_at: Optional[datetime] = None
    install_mode: str = "source"
    platform: str
    arch: str
    recommended_asset: Optional[UpdateAsset] = None
    assets: list[UpdateAsset] = []
    error: Optional[str] = None


# ── Drive sync ────────────────────────────────────────────────────────────────


class DriveCredentialsRequest(BaseModel):
    client_id: str
    client_secret: str


class DriveAuthStartResponse(BaseModel):
    auth_url: str


class DriveStatus(BaseModel):
    configured: bool = False  # client_id + secret saved
    signed_in: bool = False
    account_email: Optional[str] = None
    auth_in_progress: bool = False
    last_push_at: Optional[datetime] = None
    last_push_name: Optional[str] = None


class DriveSnapshot(BaseModel):
    id: str
    name: str
    size: Optional[int] = None
    created_time: Optional[datetime] = None
    modified_time: Optional[datetime] = None


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

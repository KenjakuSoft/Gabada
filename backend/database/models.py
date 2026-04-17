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
    base_url: str

class Store(StoreCreate):
    id: int
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Scrape config ─────────────────────────────────────────────────────────────

class ScrapeSelectors(BaseModel):
    title: Optional[str] = None
    price: Optional[str] = None
    discounted_price: Optional[str] = None
    dealer_price: Optional[str] = None
    stock_status: Optional[str] = None
    image: Optional[str] = None

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


# ── Manual override ───────────────────────────────────────────────────────────

class ProductStoreOverrideUpsert(BaseModel):
    manual_price: Optional[float] = None
    manual_stock_status: Optional[str] = None
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
    product_url: str
    scrape_config: ScrapeConfig = ScrapeConfig()

class ProductStoreSummary(BaseModel):
    id: int
    store_id: int
    store_name: str
    store_base_url: str
    product_url: str
    is_active: bool
    latest_price: Optional[float] = None
    latest_discounted_price: Optional[float] = None
    latest_dealer_price: Optional[float] = None
    latest_stock_status: Optional[str] = None
    latest_scraped_at: Optional[datetime] = None
    latest_change_type: Optional[str] = None
    latest_price_delta: Optional[float] = None
    manual_price: Optional[float] = None
    manual_stock_status: Optional[str] = None
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
    stock_status: Optional[str] = None
    change_type: Optional[str] = None
    price_delta: Optional[float] = None

    model_config = {"from_attributes": True}


class ActivityEntry(BaseModel):
    id: int
    product_id: int
    product_name: str
    store_name: str
    change_type: str
    price: Optional[float] = None
    discounted_price: Optional[float] = None
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

class WooImportRequest(BaseModel):
    credentials: WooCredentials
    store_id: int
    product_ids: list[int]


# ── File import ───────────────────────────────────────────────────────────────

class FileImportPreviewResponse(BaseModel):
    columns: list[str]
    sample_rows: list[list[str]]
    total_rows: int
    file_format: str  # "csv", "excel", "pdf"

class FileImportRow(BaseModel):
    name: str
    url: str
    image_url: Optional[str] = None

class FileImportCommitRequest(BaseModel):
    rows: list[FileImportRow]
    store_id: int
    category_id: Optional[int] = None


# ── Probe / diagnostics ───────────────────────────────────────────────────────

class ProbeCandidate(BaseModel):
    text: str
    value: Optional[float] = None
    score: int = 0
    font_size: Optional[float] = None
    font_weight: Optional[int] = None
    struck: bool = False
    dealer: bool = False
    dom_path: Optional[str] = None


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
    notes: list[str] = Field(default_factory=list)


class ProbeRequest(BaseModel):
    url: str
    use_playwright: bool = True
    wait_for: Optional[str] = None
    wait_timeout: int = 15000
    cookies: list[dict[str, Any]] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    storage_state_path: Optional[str] = None


class LoginSessionRequest(BaseModel):
    url: str
    save_path: str  # absolute or relative path where storage_state.json will be written
    headless: bool = False
    wait_seconds: int = 180  # how long to keep browser open for manual login

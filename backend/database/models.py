from pydantic import BaseModel
from typing import Optional
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
    stock_status: Optional[str] = None
    image: Optional[str] = None

class ScrapeConfig(BaseModel):
    use_playwright: bool = True
    wait_for: Optional[str] = None       # CSS selector to wait for (SPAs)
    wait_timeout: int = 15000            # ms
    selectors: ScrapeSelectors = ScrapeSelectors()


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
    latest_stock_status: Optional[str] = None
    latest_scraped_at: Optional[datetime] = None
    latest_change_type: Optional[str] = None
    latest_price_delta: Optional[float] = None

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
    stock_status: str = "unknown"
    raw_price: Optional[str] = None
    raw_discounted: Optional[str] = None
    error: Optional[str] = None

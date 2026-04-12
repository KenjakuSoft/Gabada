# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Gabada** — a product price & stock tracker. Scrapes product listings from online shops (both static HTML and JS-heavy SPAs), logs price and stock status daily, and displays history with charts and a calendar picker.

## Architecture

```
Gabada/
├── backend/        ← Python: scraping, storage, REST API
│   ├── main.py     ← FastAPI entry point (uvicorn)
│   ├── database/   ← SQLite schema + async queries (aiosqlite)
│   ├── scraper/    ← Playwright-based scraper engine
│   ├── api/        ← Route handlers (products, stores, logs, scraper)
│   └── scheduler/  ← APScheduler daily auto-scrape jobs
└── frontend/       ← Flutter desktop app
    └── lib/
        ├── screens/   ← Home, ProductDetail, AddProduct
        ├── models/    ← Dart data classes (Product, Store, PriceLog)
        ├── services/  ← ApiService (calls FastAPI on localhost:8000)
        ├── widgets/   ← ProductCard, PriceChart, StoreRow
        └── theme/     ← AppTheme (Material 3, dark/light)
```

## Backend

**Stack:** Python 3.11+ · FastAPI · aiosqlite · Playwright · APScheduler · Pydantic v2

**Run dev server:**
```bash
cd ~/Desktop/Gabada/backend
uvicorn main:app --reload --port 8000
```

**Install deps:**
```bash
pip install -r requirements.txt
playwright install chromium
```

**API base:** `http://localhost:8000`

## Frontend

**Stack:** Flutter 3.41.6 · Dart · provider · dio · fl_chart · table_calendar · cached_network_image

**Run:**
```bash
cd ~/Desktop/Gabada/frontend
flutter run -d windows
```

**Build release:**
```bash
flutter build windows
```

## Database Schema

Four tables in `backend/gabada.db`:

- `products` — canonical product (name, image_url)
- `stores` — shop sources (name, base_url)
- `product_stores` — links a product to a store URL + JSON `scrape_config`
- `price_logs` — daily snapshots (price, discounted_price, stock_status)

One product row → many store sub-rows (one per shop carrying it).

## Scraper Config (per product_store)

Each `product_store` row carries a `scrape_config` JSON that tells the engine what to extract:

```json
{
  "use_playwright": true,
  "wait_for": ".product-price",
  "selectors": {
    "title": "h1.product-title",
    "price": ".price-now",
    "discounted_price": ".price-was",
    "stock_status": ".availability",
    "image": "img.product-main"
  }
}
```

- `use_playwright`: set `false` only for pure static HTML (faster)
- `wait_for`: CSS selector Playwright waits for before extracting (critical for SPAs)
- All selectors are optional — missing ones result in `null` in the log

## Key Design Rules

- **One Playwright browser instance** shared across scrapes (start at app launch, reuse context)
- **Never scrape in the API request cycle** — scraping is always dispatched to background tasks or the scheduler
- **Price parsing** strips currency symbols, spaces, commas before casting to float
- **Stock status** normalizes to: `in_stock` | `out_of_stock` | `limited` | `unknown`
- Flutter calls the backend only via `ApiService` — never raw http calls in widgets
- All Flutter state lives in `Provider` notifiers, not in widget `setState`

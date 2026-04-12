# Gabada

**Gabada** is a desktop application for tracking product prices and stock availability across multiple online stores. Add any product, link it to one or more store URLs, and Gabada will automatically scrape price and stock data daily — storing a full history you can visualise as a chart, filter by date range, and monitor through an activity feed.

> Built for Windows. Backend: Python + FastAPI. Frontend: Flutter desktop.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the App](#running-the-app)
- [Usage Guide](#usage-guide)
  - [Adding a Product](#adding-a-product)
  - [Linking a Store](#linking-a-store)
  - [Triggering a Scrape](#triggering-a-scrape)
  - [Viewing Price History](#viewing-price-history)
  - [Activity Feed](#activity-feed)
  - [Categories](#categories)
- [Scraper Engine](#scraper-engine)
  - [Extraction Strategies](#extraction-strategies)
  - [Scrape Config Reference](#scrape-config-reference)
- [REST API Reference](#rest-api-reference)
  - [Products](#products-api)
  - [Stores](#stores-api)
  - [Logs](#logs-api)
  - [Scraper](#scraper-api)
  - [Categories](#categories-api)
  - [Activity](#activity-api)
- [Database Schema](#database-schema)
- [Common Errors & Solutions](#common-errors--solutions)
- [Contributing](#contributing)
- [Changelog](#changelog)

---

## Overview

| Feature | Detail |
|---|---|
| **Price tracking** | Stores full price history per product per store |
| **Stock monitoring** | Normalises stock status to `in_stock`, `out_of_stock`, `limited`, `unknown` |
| **Auto-scrape** | APScheduler fires a scrape of all active products at **08:00 daily** |
| **Manual scrape** | Trigger an immediate scrape from the UI or via REST API |
| **Price chart** | Interactive line chart per product with optional date-range filter |
| **Activity feed** | Shows only meaningful changes (price up/down, stock in/out) |
| **Categories** | Colour-coded labels for organising products |
| **No-config scraping** | Works on most e-commerce sites without writing any CSS selectors |

---

## Architecture

```
Gabada/
├── backend/                  ← Python 3.11+
│   ├── main.py               ← FastAPI entry point (uvicorn, port 8000)
│   ├── database/
│   │   ├── db.py             ← aiosqlite connection, migrations
│   │   └── models.py         ← Pydantic v2 models
│   ├── scraper/
│   │   └── engine.py         ← Playwright scraper, 4-strategy extraction
│   ├── scheduler/
│   │   └── jobs.py           ← APScheduler daily job
│   └── api/
│       ├── products.py       ← /products  endpoints
│       ├── stores.py         ← /stores    endpoints
│       ├── logs.py           ← /logs      endpoints
│       ├── scraper_routes.py ← /scraper   endpoints
│       ├── categories.py     ← /categories endpoints
│       └── activity.py       ← /activity  endpoints
│
├── frontend/                 ← Flutter 3.41+ (Windows desktop)
│   └── lib/
│       ├── screens/          ← Home, ProductDetail, AddProduct, Activity
│       ├── models/           ← Dart data classes
│       ├── providers/        ← ChangeNotifier state management
│       ├── services/         ← ApiService (Dio HTTP client)
│       └── widgets/          ← ProductCard, StoreRow, PriceChart, etc.
│
├── start_gabada.bat          ← One-click launcher (Windows)
└── README.md
```

**Data flow:**

```
Flutter UI  ──HTTP──▶  FastAPI (port 8000)  ──async──▶  aiosqlite (gabada.db)
                               │
                        APScheduler / manual trigger
                               │
                        Playwright browser  ──▶  Target store page
```

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Windows | 10 / 11 | Linux/macOS works too — skip the `.bat` launcher |
| Python | 3.11 | 3.14 confirmed working |
| Flutter | 3.24 | 3.41.6 recommended |
| Dart SDK | 3.5 | Bundled with Flutter |
| Git | any | For cloning |
| Internet | required | Scraping fetches live pages |

> **No browser installation needed.** Playwright downloads its own Chromium binary during setup.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/XxOtakuXx/Gabada.git
cd Gabada
```

### 2. Set up the Python backend

```bash
cd backend

# Create and activate a virtual environment (recommended)
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Download Playwright's Chromium browser
playwright install chromium
```

### 3. Set up the Flutter frontend

```bash
cd ../frontend
flutter pub get
```

### 4. Verify the setup

```bash
# Backend — should print "ok"
cd backend
uvicorn main:app --port 8000 &
curl http://localhost:8000/health
# {"status":"ok"}

# Frontend — should open a Windows window
cd ../frontend
flutter run -d windows
```

---

## Configuration

Gabada requires **no configuration files**. Everything is stored in `backend/gabada.db` (SQLite, auto-created on first run).

### Changing the backend port

The frontend hard-codes `http://localhost:8000`. If you change the port:

1. Edit `backend/start_gabada.bat` — change `--port 8000`
2. Edit `frontend/lib/services/api_service.dart` — change `_base`

```dart
// frontend/lib/services/api_service.dart
static const _base = 'http://localhost:8000';   // ← change here
```

### Changing the daily scrape schedule

Edit `backend/scheduler/jobs.py`:

```python
_scheduler.add_job(
    scrape_all_active,
    trigger=CronTrigger(hour=8, minute=0),   # ← 08:00 daily
    ...
)
```

Uses [APScheduler CronTrigger](https://apscheduler.readthedocs.io/en/stable/modules/triggers/cron.html) syntax. Examples:

| Schedule | `hour` | `minute` |
|---|---|---|
| 08:00 daily (default) | `8` | `0` |
| Every 6 hours | `*/6` | `0` |
| Midnight | `0` | `0` |
| Twice daily | `8,20` | `0` |

### Environment variables

None required. The database path is resolved relative to `backend/database/db.py`:

```python
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "gabada.db")
```

To relocate the database, change `DB_PATH` in `backend/database/db.py`.

---

## Running the App

### Option A — One-click launcher (Windows)

Double-click `start_gabada.bat`. It opens two terminal windows:

- **Gabada Backend** — uvicorn on port 8000
- **Gabada Frontend** — Flutter debug build

Both windows show live logs. Close either window to shut down that process.

### Option B — Manual (any OS)

**Terminal 1 — backend:**

```bash
cd backend
source .venv/bin/activate        # skip on Windows if using global Python
uvicorn main:app --reload --port 8000
```

`--reload` enables hot-restart on code changes. Omit for production.

**Terminal 2 — frontend:**

```bash
cd frontend
flutter run -d windows           # or -d linux / -d macos
```

### Option C — Release build

```bash
cd frontend
flutter build windows
# Output: frontend/build/windows/x64/runner/Release/gabada.exe
```

Distribute the entire `Release/` folder — it contains the required DLLs.

---

## Usage Guide

### Adding a Product

1. Click **+ Add Product** (floating button, bottom-right of home screen).
2. Enter the product's **canonical name** — this is your label, not scraped.
3. Optionally paste an **image URL** for the thumbnail.
4. Optionally assign a **category**.
5. Click **Save**.

The product appears in the home list. Prices show `—` until the first scrape.

### Linking a Store

Each product can be tracked across multiple stores independently.

1. Open a product → tap **Add Store**.
2. Select an existing store from the dropdown, or click **Create new store** to add one inline.
   - **Store name**: display label (e.g. `redacted-store`)
   - **Base URL**: root domain (e.g. `https://www.redacted-store`)
3. Paste the **product URL** — the exact URL of this product on that store.
4. Click **Link**.

Gabada will scrape that URL automatically on the next scheduled run, or immediately if you trigger a manual scrape.

### Triggering a Scrape

**Scrape a single store:**  
In the product detail screen, tap the **↻ refresh icon** on any store row. The app polls every 5 seconds and updates the row automatically when the scrape completes (up to ~35 seconds).

**Scrape all products:**  
On the home screen, tap the **↻ refresh icon** in the top-right app bar. The app reloads the product list every 10 seconds for 60 seconds, picking up results as each store completes.

**Via API:**

```bash
# Scrape one product_store
curl -X POST http://localhost:8000/scraper/scrape/9

# Scrape everything
curl -X POST http://localhost:8000/scraper/scrape-all
```

Both return `202 Accepted` immediately. The scrape runs in the background.

### Viewing Price History

Open any product → the **Price History** chart appears at the top (once at least one log exists).

- The Y-axis shows prices (Rs. format).
- The X-axis shows dates.
- The chart covers all stores for the product overlaid.
- Use the **calendar icon** (top-right of detail screen) to filter a custom date range.

### Activity Feed

The activity feed shows only scrapes where something **changed** — price increases, price drops, stock going in or out. Unchanged scrapes are silently recorded but not shown here.

Access via the **Activity** tab/screen (bottom navigation or side drawer depending on your build).

**Filtering by change type:**

```bash
# API — show only price drops
curl "http://localhost:8000/activity/?change_type=price_down&limit=50"
```

| `change_type` value | Meaning |
|---|---|
| `new` | First scrape ever for this product-store |
| `price_up` | Price increased |
| `price_down` | Price decreased |
| `price_and_stock` | Both price and stock changed in one scrape |
| `stock_in` | Stock became `in_stock` or `limited` |
| `stock_out` | Stock became `out_of_stock` |
| `stock_change` | Stock changed to an unclassified state |
| `no_change` | No change detected (recorded but filtered from activity) |

### Categories

Categories are colour-coded labels for grouping products (e.g. *CPUs*, *GPUs*, *Storage*).

- **Create:** Home screen → label icon → *New Category* panel → pick a colour → enter name → **Add**.
- **Filter:** Tap a category chip at the top of the home screen to show only products in that category.
- **Delete:** Home screen → label icon → trash icon next to any category.

Deleting a category sets all products in that category to uncategorised (no cascade delete on products).

---

## Scraper Engine

The scraper engine (`backend/scraper/engine.py`) uses a shared Playwright Chromium instance (started once at app launch, reused across all scrapes to save memory and startup time).

### Extraction Strategies

Strategies run in order. The first strategy to return a price wins. Stock status gaps are filled by later strategies.

```
Request URL
    │
    ▼
1. JSON-LD  ──────────────────── <script type="application/ld+json">
    │ miss
    ▼
2. Schema.org microdata  ──────── [itemprop="price"], [itemprop="availability"]
    │ miss / no stock
    ▼
3. Universal JS smart scan  ───── Scores all visible price-like text nodes by
    │                              DOM context; inspects cart/buy buttons for stock
    │ miss
    ▼
4. Common CSS patterns  ──────── Known selectors for Amazon, Shopify, WooCommerce,
    │                             CS-Cart, plain PHP stores, etc.
    │
    ▼
5. Custom selectors (optional) ── Per-product-store overrides defined in scrape_config
```

**Strategy 3 (Smart Scan)** works on any site without configuration. It:

- Walks all visible text nodes matching price-like patterns
- Scores each by how "price-adjacent" its DOM ancestors are (class/id keywords like `price`, `amount`, `sale`, penalises `cart`, `related`, `footer`)
- Detects stock by inspecting add-to-cart / buy button state and full-page text

### Scrape Config Reference

Each product-store link carries an optional `scrape_config` JSON object. All fields are optional — omit entirely to rely on the auto-detection strategies.

```json
{
  "use_playwright": true,
  "wait_for": ".product-price",
  "wait_timeout": 15000,
  "selectors": {
    "title": "h1.product-title",
    "price": ".price-now",
    "discounted_price": ".price-was",
    "stock_status": ".availability"
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `use_playwright` | `bool` | `true` | Set `false` only for plain static HTML pages (faster, no JS execution) |
| `wait_for` | `string \| null` | `null` | CSS selector Playwright waits for before extracting. Critical for SPAs that render content asynchronously |
| `wait_timeout` | `int` (ms) | `15000` | How long to wait for `wait_for` before giving up and extracting anyway |
| `selectors.title` | `string \| null` | `null` | CSS selector for the product title |
| `selectors.price` | `string \| null` | `null` | CSS selector for the current/sale price |
| `selectors.discounted_price` | `string \| null` | `null` | CSS selector for the original/retail price (when a discount is shown) |
| `selectors.stock_status` | `string \| null` | `null` | CSS selector for a stock availability element |

Custom selectors act as **overrides** — they are applied last and replace any auto-detected values for the fields specified. Leave a selector `null` to keep the auto-detected value for that field.

**Example — CS-Cart store (redacted-store):**

```json
{
  "use_playwright": true,
  "wait_for": ".ty-price-now",
  "selectors": {
    "price": ".ty-price-now",
    "stock_status": ".ty-special-msg"
  }
}
```

**Example — Plain PHP store (redacted-store):**

```json
{
  "use_playwright": false,
  "selectors": {
    "price": "h4.price span"
  }
}
```

**Price normalisation rules:**

- Currency symbols (`Rs.`, `LKR`, `$`, `€`, `£`, etc.) are stripped before parsing
- European format (`1.299,99`) and US format (`1,299.99`) are both handled
- Values ≤ 0 are discarded
- If a `discounted_price` selector is provided, the two prices are interpreted as *sale price* and *original price*

**Stock normalisation — text to enum:**

| Detected text (case-insensitive) | Stored value |
|---|---|
| `out of stock`, `sold out`, `unavailable`, `not available` | `out_of_stock` |
| `limited`, `low stock`, `only X left`, `hurry`, `few left` | `limited` |
| `in stock`, `available`, `add to cart`, `buy now` | `in_stock` |
| Schema.org `availability` URL contains `InStock` | `in_stock` |
| Schema.org `availability` URL contains `OutOfStock` | `out_of_stock` |
| Anything else | `unknown` |

---

## REST API Reference

The API is available at `http://localhost:8000`. Interactive docs: `http://localhost:8000/docs`.

### Products API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/products/` | List all products. Optional `?category_id=` filter |
| `GET` | `/products/{id}` | Get one product with all store summaries |
| `POST` | `/products/` | Create a product |
| `PATCH` | `/products/{id}` | Update a product |
| `DELETE` | `/products/{id}` | Delete product and all its logs |
| `POST` | `/products/{id}/stores` | Link a store URL to a product |
| `DELETE` | `/products/{id}/stores/{ps_id}` | Unlink a store |

**Create product — request body:**

```json
{
  "canonical_name": "AMD Ryzen 7 9800X3D",
  "image_url": "https://example.com/image.jpg",
  "category_id": 2
}
```

**Link store — request body:**

```json
{
  "store_id": 1,
  "product_url": "https://store.example.com/product/amd-9800x3d",
  "scrape_config": {
    "use_playwright": true,
    "wait_for": ".price"
  }
}
```

### Stores API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/stores/` | List all stores |
| `POST` | `/stores/` | Create a store |
| `DELETE` | `/stores/{id}` | Delete a store |

**Create store — request body:**

```json
{
  "name": "redacted-store",
  "base_url": "https://www.redacted-store"
}
```

> `base_url` must be unique. Duplicate attempts return `409 Conflict`.

### Logs API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/logs/` | Logs for a single product-store link |
| `GET` | `/logs/product/{product_id}` | All logs for all stores of a product |

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `product_store_id` | `int` | required (for `/logs/`) | ID of the product-store link |
| `from` | `date` (YYYY-MM-DD) | none | Start date filter |
| `to` | `date` (YYYY-MM-DD) | none | End date filter |
| `limit` | `int` | 365 / 1000 | Maximum rows returned |

**Example:**

```bash
# Price history for product 8, last 30 days
curl "http://localhost:8000/logs/product/8?from=2026-03-13&to=2026-04-13"
```

### Scraper API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/scraper/scrape/{product_store_id}` | Scrape one product-store immediately |
| `POST` | `/scraper/scrape-all` | Scrape all active product-stores |

Both return `202 Accepted`. Scraping runs in a background task and does **not** block the HTTP response. Poll `/products/{id}` or `/logs/` to see when new data appears.

```bash
curl -X POST http://localhost:8000/scraper/scrape/9
# {"status":"queued","product_store_id":9}

curl -X POST http://localhost:8000/scraper/scrape-all
# {"status":"queued"}
```

### Categories API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/categories/` | List all categories |
| `POST` | `/categories/` | Create a category |
| `PATCH` | `/categories/{id}` | Update a category |
| `DELETE` | `/categories/{id}` | Delete a category |

**Create category — request body:**

```json
{
  "name": "Processors",
  "color": "#6C63FF"
}
```

`color` must be a valid hex string (`#RRGGBB`). Duplicate names return `409 Conflict`.

### Activity API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/activity/` | Recent price and stock change events |

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | `int` | `100` | Max results (maximum `500`) |
| `offset` | `int` | `0` | Pagination offset |
| `change_type` | `string` | none | Filter to a specific change type |

```bash
# Latest 20 price drops
curl "http://localhost:8000/activity/?change_type=price_down&limit=20"

# Page 2
curl "http://localhost:8000/activity/?limit=100&offset=100"
```

---

## Database Schema

`backend/gabada.db` — SQLite, WAL mode, foreign keys enabled.

```sql
-- Product grouping labels
CREATE TABLE categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    color      TEXT    NOT NULL DEFAULT '#6C63FF',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- A product you want to track (your label, not scraped)
CREATE TABLE products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT    NOT NULL,
    image_url      TEXT,
    category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- A store / online shop
CREATE TABLE stores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    base_url   TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Link: one product as sold on one specific store
CREATE TABLE product_stores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id     INTEGER NOT NULL REFERENCES stores(id)   ON DELETE CASCADE,
    product_url  TEXT    NOT NULL,
    scrape_config TEXT   NOT NULL DEFAULT '{}',  -- JSON: ScrapeConfig
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, store_id)
);

-- One row per scrape run
CREATE TABLE price_logs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    product_store_id      INTEGER NOT NULL REFERENCES product_stores(id) ON DELETE CASCADE,
    scraped_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    title                 TEXT,
    price                 REAL,         -- original/retail price
    discounted_price      REAL,         -- sale price (if discounted)
    stock_status          TEXT DEFAULT 'unknown',
    raw_price             TEXT,         -- unparsed string from the page
    raw_discounted        TEXT,
    change_type           TEXT,         -- see activity change types
    price_delta           REAL,         -- new_price - prev_price (signed)
    previous_price        REAL,
    previous_stock_status TEXT
);
```

**Indexes:**

```sql
CREATE INDEX idx_price_logs_product_store ON price_logs(product_store_id);
CREATE INDEX idx_price_logs_scraped_at    ON price_logs(scraped_at);
CREATE INDEX idx_price_logs_change        ON price_logs(change_type, scraped_at);
```

**Effective price logic:**  
`discounted_price` holds the **current/sale** price when a discount is active; `price` holds the original/strikethrough price. When no discount exists, `price` holds the current price and `discounted_price` is `NULL`. Use `COALESCE(discounted_price, price)` to get the price a customer would actually pay.

---

## Common Errors & Solutions

### Backend won't start

**Error:**
```
ModuleNotFoundError: No module named 'fastapi'
```
**Solution:** Dependencies not installed. Run:
```bash
pip install -r requirements.txt
```

---

**Error:**
```
playwright._impl._errors.Error: Executable doesn't exist at ...
```
**Solution:** Playwright's Chromium binary is missing. Run:
```bash
playwright install chromium
```

---

**Error (Windows):**
```
NotImplementedError: ...ProactorEventLoop...
```
**Solution:** Already fixed in `main.py` via `WindowsProactorEventLoopPolicy`. If you see this, ensure you are running `python -m uvicorn main:app` from the `backend/` directory, not the repo root.

---

### Frontend can't reach the backend

**Symptom:** Home screen shows "Cannot reach backend" with a wifi-off icon.

**Solutions:**
1. Confirm the backend is running: `curl http://localhost:8000/health` should return `{"status":"ok"}`
2. Confirm uvicorn is bound to port 8000, not another port
3. Check Windows Firewall is not blocking localhost connections
4. On Windows, try running the backend terminal as Administrator

---

### Scrape returns no price

**Symptom:** `price=None` in logs, `—` shown in UI.

**Causes and solutions:**

| Cause | Solution |
|---|---|
| Page requires JavaScript and `use_playwright` is `false` | Set `"use_playwright": true` in `scrape_config` |
| SPA renders content after page load | Add `"wait_for": "<selector-that-appears-when-loaded>"` |
| Site uses an unusual price format | Add a custom `selectors.price` CSS selector |
| Site blocks headless browsers | The smart scanner still attempts extraction; some bot-protected sites (Cloudflare, etc.) cannot be scraped |
| Timeout too short | Increase `"wait_timeout"` from `15000` to `30000` (ms) |

To debug, run a one-off scrape with logging and inspect output:

```bash
cd backend
python3 -c "
import asyncio
from scraper.engine import start_browser, stop_browser, scrape
from database.models import ScrapeConfig

async def main():
    await start_browser()
    result = await scrape('https://your-product-url.com', ScrapeConfig())
    print(result)
    await stop_browser()

asyncio.run(main())
"
```

---

### Store already exists (409)

**Error:**
```json
{"detail": "Store with this base_url already exists"}
```
**Solution:** Each store `base_url` must be unique. If you want to track a product on an already-registered store, use the existing store's `id` when adding a product-store link.

---

### Database locked

**Error:**
```
aiosqlite.OperationalError: database is locked
```
**Solution:** SQLite WAL mode is already enabled. This error usually means two separate processes have the database open simultaneously with conflicting writes. Ensure only one uvicorn instance is running:
```bash
# Windows
tasklist | findstr uvicorn
taskkill /IM uvicorn.exe /F
```

---

### Flutter build errors

**Error:**
```
Error: Cannot run with sound null safety
```
**Solution:** Ensure Flutter SDK ≥ 3.0 and Dart SDK ≥ 3.0 are active:
```bash
flutter --version
dart --version
```

**Error:**
```
Package X not found
```
**Solution:**
```bash
cd frontend
flutter pub get
```

---

## Contributing

Contributions are welcome. Please follow these guidelines:

### Development workflow

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Backend changes** — run the dev server with reload:
   ```bash
   cd backend
   uvicorn main:app --reload --port 8000
   ```

3. **Frontend changes** — Flutter hot-reload is active during `flutter run`:
   Press `r` in the terminal to hot-reload, `R` for a full restart.

4. **Lint before committing:**
   ```bash
   # Backend
   pip install ruff
   ruff check backend/

   # Frontend
   cd frontend && dart analyze
   ```

5. **Commit message format:**
   ```
   <type>: <short description>

   <optional body>
   ```
   Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`

   Examples:
   ```
   feat: add price alert notifications
   fix: handle EUR comma-decimal price format
   docs: update scrape_config reference table
   ```

6. **Pull request checklist:**
   - [ ] `dart analyze` reports no issues
   - [ ] `ruff check backend/` reports no issues
   - [ ] New scraper logic tested against at least one real URL
   - [ ] No `gabada.db`, `__pycache__/`, or `.claude/` files staged

### Adding support for a new store type

1. Test the auto-detection first — run the debug scrape snippet above
2. If auto-detection works: no code change needed, just use `ScrapeConfig()` defaults
3. If auto-detection misses the price: add CSS selectors to `_PRICE_SELECTORS` / `_STOCK_SELECTORS` in `backend/scraper/engine.py`, or document a `scrape_config` example in this README
4. If the site has an unusual structure: add a new strategy function `_try_<sitename>` and call it from `scrape()`

### Project structure decisions

| Decision | Rationale |
|---|---|
| Single shared Playwright browser | Saves ~200 MB RAM and 3–5 s startup time per scrape |
| Scraping always in background tasks | API responses stay fast; scraping blocks for 5–30 s |
| Sequential `scrape_all_active` | Avoids overwhelming target servers; polite scraping |
| SQLite over Postgres | Zero-config, single file, sufficient for personal/small-team use |
| No authentication | Local desktop app; backend binds to localhost only |

---

## Changelog

### [0.2.0] — 2026-04-13

#### Added
- Activity feed: shows price and stock change events with `change_type` classification (`price_up`, `price_down`, `stock_in`, `stock_out`, `new`, etc.)
- Categories: colour-coded product labels with chip filter on home screen
- Category manager bottom sheet with colour palette picker
- `change_type`, `price_delta`, `previous_price`, `previous_stock_status` columns in `price_logs`
- `start_gabada.bat` — one-click Windows launcher

#### Changed
- Home screen scrape-all now auto-reloads every 10 s for 60 s instead of never refreshing
- Per-store scrape now polls every 5 s (up to 35 s) and dismisses snackbar when new log arrives
- All price displays changed from `$` to `Rs.` with comma-formatted integers

#### Fixed
- `WindowsProactorEventLoopPolicy` set before FastAPI import to prevent Playwright subprocess errors on Windows
- `BuildContext` captured before first `await` in scrape callbacks to resolve `use_build_context_synchronously` lint warning

---

### [0.1.0] — 2026-04-12

#### Added
- Initial scaffold: FastAPI backend + Flutter desktop frontend
- SQLite schema: `products`, `stores`, `product_stores`, `price_logs`
- Playwright scraper engine with 4-strategy extraction:
  - JSON-LD structured data
  - Schema.org microdata
  - Universal JS smart scan (works on any site, no config)
  - Common CSS pattern library (Amazon, Shopify, WooCommerce, CS-Cart, etc.)
- Custom `scrape_config` per product-store for manual selector overrides
- APScheduler daily auto-scrape at 08:00
- REST API: products, stores, logs, scraper trigger endpoints
- Flutter screens: Home (product list), ProductDetail (chart + stores), AddProduct
- Price history line chart with date-range filter
- Stock status badges (`in_stock`, `out_of_stock`, `limited`, `unknown`)
- Price change indicator icons on product cards

---

*Made with Flutter and FastAPI.*

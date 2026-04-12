<div align="center">

```
 ██████╗  █████╗ ██████╗  █████╗ ██████╗  █████╗
██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ███╗███████║██████╔╝███████║██║  ██║███████║
██║   ██║██╔══██║██╔══██╗██╔══██║██║  ██║██╔══██║
╚██████╔╝██║  ██║██████╔╝██║  ██║██████╔╝██║  ██║
 ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝
```

### Track prices. Catch drops. Never overpay.

<br/>

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Flutter](https://img.shields.io/badge/Flutter-3.41%2B-02569B?style=for-the-badge&logo=flutter&logoColor=white)](https://flutter.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111%2B-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Playwright](https://img.shields.io/badge/Playwright-1.44%2B-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)]()

<br/>

*A desktop app that watches product prices across any online store —
automatically scraping, logging history, and surfacing every change.*

<br/>

[**Quick Start**](#-quick-start) · [**Features**](#-features) · [**API Docs**](#-rest-api-reference) · [**Contributing**](#-contributing)

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

**🔍 Smart Scraping**
- Works on any e-commerce site — no CSS selectors required
- 4-strategy extraction: JSON-LD → Schema.org → JS Smart Scan → CSS patterns
- Handles SPAs, lazy-loaded content, and JS-heavy stores
- One shared Playwright browser — fast and memory-efficient

</td>
<td width="50%">

**📊 Price Intelligence**
- Full price history stored per product per store
- Interactive line chart with date-range filtering
- Detects price-up, price-down, stock-in, stock-out events
- Activity feed shows only meaningful changes — no noise

</td>
</tr>
<tr>
<td width="50%">

**🏷️ Organisation**
- Colour-coded categories for grouping products
- Track the same product across multiple stores side-by-side
- Lowest-price badge on every product card
- Stock status badges: In Stock · Limited · Out of Stock

</td>
<td width="50%">

**⚡ Automation**
- Daily auto-scrape at 08:00 via APScheduler
- Manual scrape from UI with live polling until results arrive
- REST API for scripting and integrations
- Zero config — drop in a URL and go

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Flutter Desktop App                   │
│   HomeScreen · ProductDetail · ActivityFeed · AddProduct │
│          Provider state · Dio HTTP · fl_chart            │
└──────────────────────┬──────────────────────────────────┘
                       │  HTTP  localhost:8000
┌──────────────────────▼──────────────────────────────────┐
│                   FastAPI Backend                        │
│  /products  /stores  /logs  /scraper  /categories        │
│              /activity  /health                          │
│                     │                     │              │
│           aiosqlite  │          APScheduler│              │
│           gabada.db  │          08:00 daily│              │
└──────────────────────┼─────────────────────┼────────────┘
                       │                     │
┌──────────────────────▼─────────────────────▼────────────┐
│                 Playwright Engine                        │
│  Strategy 1: JSON-LD structured data                     │
│  Strategy 2: Schema.org microdata                        │
│  Strategy 3: Universal JS smart scan  ← works anywhere  │
│  Strategy 4: CSS pattern library (Amazon/Shopify/etc.)   │
└─────────────────────────────────────────────────────────┘
```

**Stack at a glance:**

| Layer | Technology |
|---|---|
| Frontend | Flutter 3.41 · Dart · Provider · Dio · fl_chart · shimmer |
| Backend | Python 3.11 · FastAPI · uvicorn · Pydantic v2 |
| Database | SQLite via aiosqlite (WAL mode, foreign keys) |
| Scraping | Playwright (Chromium) · APScheduler |
| Platform | Windows 10/11 (Linux/macOS also work) |

---

## ⚡ Quick Start

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | ≥ 3.11 | [python.org](https://python.org) |
| Flutter | ≥ 3.24 | [flutter.dev](https://flutter.dev) |
| Git | any | [git-scm.com](https://git-scm.com) |

> **No browser install needed.** Playwright downloads its own Chromium binary.

### 1 · Clone

```bash
git clone https://github.com/XxOtakuXx/Gabada.git
cd Gabada
```

### 2 · Backend setup

```bash
cd backend

# Create a virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# Install Python dependencies
pip install -r requirements.txt

# Download Playwright's Chromium
playwright install chromium
```

### 3 · Frontend setup

```bash
cd ../frontend
flutter pub get
```

### 4 · Launch

**Windows — one click:**

```
Double-click  start_gabada.bat
```

Two terminals open: one for the backend, one for the Flutter app.

**Manual (any OS):**

```bash
# Terminal 1 — backend
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && flutter run -d windows
```

### 5 · Verify

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

Open `http://localhost:8000/docs` for the interactive API explorer.

---

## 📖 Usage Guide

### Adding a product

1. Click **`+ Add Product`** (bottom-right floating button)
2. Enter a **canonical name** — your label for the product
3. Optionally add an **image URL** and assign a **category**
4. Hit **Save**

> Prices show `—` until the first scrape completes.

### Linking a store

Each product can be tracked across multiple stores independently.

1. Open a product → tap **Add Store**
2. Select an existing store or click **Create new store** inline
3. Paste the **exact product URL** on that store
4. Click **Link**

### Triggering a scrape

| Action | How |
|---|---|
| Scrape one store | Product detail screen → **↻** on any store row |
| Scrape everything | Home screen → **↻** icon (top-right app bar) |
| API — one store | `POST /scraper/scrape/{product_store_id}` |
| API — all stores | `POST /scraper/scrape-all` |

After triggering from the UI, the app polls automatically and updates when results arrive — no manual refresh needed.

### Reading the activity feed

The activity feed filters out unchanged scrapes and shows only events that matter:

| Icon | Event | `change_type` |
|---|---|---|
| 🆕 | First scrape ever | `new` |
| 📈 | Price went up | `price_up` |
| 📉 | Price dropped | `price_down` |
| 📈📦 | Price + stock both changed | `price_and_stock` |
| ✅ | Back in stock | `stock_in` |
| ❌ | Out of stock | `stock_out` |
| 🔄 | Other stock change | `stock_change` |

### Managing categories

**Home screen → label icon (top-right) → Category Manager**

- Pick a colour from the palette
- Type a name → **Add**
- Filter the home list by tapping any category chip
- Delete via the trash icon

---

## 🕷️ Scraper Engine

### Extraction strategy waterfall

```
 Navigate to URL (Playwright, headless Chromium)
           │
           ▼
 ┌─────────────────────┐
 │  1. JSON-LD         │  <script type="application/ld+json"> → Product schema
 └──────────┬──────────┘
      miss  │
            ▼
 ┌─────────────────────┐
 │  2. Schema microdata│  [itemprop="price"], [itemprop="availability"]
 └──────────┬──────────┘
      miss  │ or stock missing
            ▼
 ┌─────────────────────┐
 │  3. JS Smart Scan   │  Scores ALL visible text nodes by DOM context;
 │  (universal)        │  inspects cart/buy button state for stock
 └──────────┬──────────┘
      miss  │
            ▼
 ┌─────────────────────┐
 │  4. CSS Patterns    │  Known selectors: Amazon, Shopify, WooCommerce,
 │                     │  CS-Cart, plain PHP stores, and more
 └──────────┬──────────┘
            │
            ▼
 ┌─────────────────────┐
 │  Custom selectors   │  Per-product-store overrides (optional, always last)
 └─────────────────────┘
```

### `scrape_config` reference

Each product-store link accepts an optional `scrape_config` JSON object. All fields are optional.

```json
{
  "use_playwright": true,
  "wait_for": ".product-price",
  "wait_timeout": 15000,
  "selectors": {
    "title":             "h1.product-title",
    "price":             ".price-now",
    "discounted_price":  ".price-was",
    "stock_status":      ".availability"
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `use_playwright` | `bool` | `true` | Set `false` for plain static HTML — skips JS execution for speed |
| `wait_for` | `string` | `null` | CSS selector Playwright waits for before extracting — critical for SPAs |
| `wait_timeout` | `int` (ms) | `15000` | Max wait time for `wait_for` |
| `selectors.title` | `string` | `null` | CSS selector for product title |
| `selectors.price` | `string` | `null` | CSS selector for current / sale price |
| `selectors.discounted_price` | `string` | `null` | CSS selector for original / retail price |
| `selectors.stock_status` | `string` | `null` | CSS selector for stock availability element |

> Custom selectors **override** auto-detected values for those fields only. Leave a field `null` to keep auto-detection for it.

<details>
<summary><strong>Example configs for common store types</strong></summary>

**CS-Cart** (e.g. redacted-store):
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

**Plain PHP store** (e.g. redacted-store):
```json
{
  "use_playwright": false,
  "selectors": {
    "price": "h4.price span"
  }
}
```

**Shopify:**
```json
{
  "use_playwright": true,
  "wait_for": ".product__price",
  "selectors": {
    "price": ".product__price"
  }
}
```

**WooCommerce:**
```json
{
  "use_playwright": true,
  "selectors": {
    "price": ".price .amount",
    "discounted_price": ".price del .amount"
  }
}
```

</details>

<details>
<summary><strong>Price & stock normalisation rules</strong></summary>

**Price parsing:**
- Currency symbols (`Rs.`, `LKR`, `$`, `€`, `£`, `¥`, etc.) are stripped
- European format `1.299,99` and US format `1,299.99` both handled
- Values ≤ 0 are discarded
- `discounted_price` = sale/current price; `price` = original/strikethrough

**Stock text → enum mapping:**

| Detected text (case-insensitive) | Stored value |
|---|---|
| `out of stock`, `sold out`, `unavailable`, `not available` | `out_of_stock` |
| `limited`, `low stock`, `only X left`, `hurry`, `few left` | `limited` |
| `in stock`, `available`, `add to cart`, `buy now` | `in_stock` |
| Schema.org URL contains `InStock` | `in_stock` |
| Schema.org URL contains `OutOfStock` | `out_of_stock` |
| Anything else / not found | `unknown` |

</details>

---

## 🌐 REST API Reference

Base URL: `http://localhost:8000`  
Interactive explorer: `http://localhost:8000/docs`

### Products

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/products/` | List all products · `?category_id=` filter |
| `GET` | `/products/{id}` | Single product with store summaries |
| `POST` | `/products/` | Create product |
| `PATCH` | `/products/{id}` | Update product |
| `DELETE` | `/products/{id}` | Delete product + all its logs |
| `POST` | `/products/{id}/stores` | Link a store URL |
| `DELETE` | `/products/{id}/stores/{ps_id}` | Unlink a store |

<details>
<summary>Request/response examples</summary>

```bash
# Create a product
curl -X POST http://localhost:8000/products/ \
  -H "Content-Type: application/json" \
  -d '{"canonical_name": "AMD Ryzen 7 9800X3D", "category_id": 1}'

# Link a store
curl -X POST http://localhost:8000/products/8/stores \
  -H "Content-Type: application/json" \
  -d '{
    "store_id": 1,
    "product_url": "https://store.example.com/product/9800x3d",
    "scrape_config": {"use_playwright": true, "wait_for": ".price"}
  }'
```

</details>

### Stores

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/stores/` | List all stores |
| `POST` | `/stores/` | Create store — `base_url` must be unique |
| `DELETE` | `/stores/{id}` | Delete store |

### Price Logs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/logs/` | Logs for one product-store · requires `?product_store_id=` |
| `GET` | `/logs/product/{id}` | All logs for every store of a product |

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | — | Start date |
| `to` | `YYYY-MM-DD` | — | End date |
| `limit` | `int` | 365 | Max rows (cap 1000 / 5000) |

```bash
# Last 30 days for product 8
curl "http://localhost:8000/logs/product/8?from=2026-03-13&to=2026-04-13"
```

### Scraper

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/scraper/scrape/{ps_id}` | Scrape one product-store (202 Accepted) |
| `POST` | `/scraper/scrape-all` | Scrape all active product-stores (202 Accepted) |

Both return immediately. Scraping runs in a background task.

```bash
curl -X POST http://localhost:8000/scraper/scrape/9
# {"status":"queued","product_store_id":9}
```

### Categories

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/categories/` | List all categories |
| `POST` | `/categories/` | Create · `{"name": "CPUs", "color": "#6C63FF"}` |
| `PATCH` | `/categories/{id}` | Update name / color |
| `DELETE` | `/categories/{id}` | Delete (products become uncategorised) |

### Activity

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/activity/` | Recent change events, newest first |

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | `int` | 100 | Max results (cap 500) |
| `offset` | `int` | 0 | Pagination offset |
| `change_type` | `string` | — | Filter: `price_down`, `stock_out`, etc. |

```bash
# Latest 20 price drops
curl "http://localhost:8000/activity/?change_type=price_down&limit=20"
```

---

## 🗄️ Database Schema

`backend/gabada.db` — SQLite, WAL mode, foreign keys ON.

```
categories          products              stores
──────────          ────────              ──────
id PK               id PK                 id PK
name UNIQUE         canonical_name        name
color               image_url             base_url UNIQUE
created_at          category_id ──▶ categories
                    created_at

product_stores                price_logs
──────────────                ──────────
id PK                         id PK
product_id ──▶ products       product_store_id ──▶ product_stores
store_id   ──▶ stores         scraped_at
product_url                   title
scrape_config (JSON)          price              ← original/retail
is_active                     discounted_price   ← sale/current
created_at                    stock_status
                              raw_price
                              change_type
                              price_delta
                              previous_price
                              previous_stock_status
```

> **Effective price:** `COALESCE(discounted_price, price)` gives the price the customer actually pays. When no discount is active, `discounted_price` is `NULL` and `price` holds the current price.

---

## 🚨 Common Errors & Solutions

<details>
<summary><strong>ModuleNotFoundError: No module named 'fastapi'</strong></summary>

Dependencies not installed, or the virtualenv is not activated.

```bash
# Activate the venv first, then:
pip install -r requirements.txt
```

</details>

<details>
<summary><strong>Playwright: Executable doesn't exist</strong></summary>

Chromium binary was never downloaded.

```bash
playwright install chromium
```

</details>

<details>
<summary><strong>"Cannot reach backend" in the Flutter UI</strong></summary>

1. Confirm backend is running: `curl http://localhost:8000/health` → `{"status":"ok"}`
2. Confirm port 8000 is not blocked by Windows Firewall
3. Ensure you launched from the `backend/` directory, not the repo root
4. Try running the backend terminal as Administrator

</details>

<details>
<summary><strong>Scrape returns no price (price = —)</strong></summary>

| Cause | Fix |
|---|---|
| Site uses JS and `use_playwright` is `false` | Set `"use_playwright": true` |
| SPA renders price after load | Add `"wait_for": "<price-selector>"` |
| Unusual price format or layout | Add `"selectors": {"price": "..."}` |
| `wait_timeout` too short | Increase to `30000` (30 s) |
| Site behind Cloudflare / bot protection | Some sites cannot be scraped headlessly |

**Debug a URL directly:**

```bash
cd backend
python3 -c "
import asyncio
from scraper.engine import start_browser, stop_browser, scrape
from database.models import ScrapeConfig

async def main():
    await start_browser()
    result = await scrape('https://your-url.com', ScrapeConfig())
    print(result)
    await stop_browser()

asyncio.run(main())
"
```

</details>

<details>
<summary><strong>409 Conflict on store creation</strong></summary>

`base_url` must be unique. Use the existing store's `id` when linking a product.

```bash
curl http://localhost:8000/stores/
# Find the existing store's id, then use it in the product-store link
```

</details>

<details>
<summary><strong>aiosqlite.OperationalError: database is locked</strong></summary>

Multiple uvicorn instances running simultaneously.

```bash
# Windows — find and kill extra instances
tasklist | findstr uvicorn
taskkill /IM uvicorn.exe /F
```

</details>

<details>
<summary><strong>Flutter: Package not found / build errors</strong></summary>

```bash
cd frontend
flutter pub get
flutter analyze        # shows any remaining issues
```

</details>

---

## 🏗️ Contributing

Contributions are welcome! Here's how to get started.

### Workflow

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_USERNAME/Gabada.git

# 2. Create a feature branch
git checkout -b feat/your-feature

# 3. Develop — backend hot-reload
cd backend && uvicorn main:app --reload --port 8000

# 4. Develop — frontend hot-reload
cd frontend && flutter run -d windows
# Press 'r' to hot-reload, 'R' for full restart

# 5. Lint
pip install ruff && ruff check backend/
cd frontend && dart analyze

# 6. Commit
git commit -m "feat: describe your change"

# 7. Open a pull request
```

### Commit message format

```
<type>: <short description>

<optional body explaining the why>
```

| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure, no behaviour change |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `test` | Tests only |
| `chore` | Tooling, deps, CI |

### Pull request checklist

- [ ] `dart analyze` — no issues
- [ ] `ruff check backend/` — no issues
- [ ] New scraper logic tested against a real URL
- [ ] `gabada.db`, `__pycache__/`, and `.claude/` not staged

### Adding support for a new store type

1. Run the debug scrape snippet above — check if auto-detection already works
2. **If it works:** document a `scrape_config` example in this README
3. **If it misses price:** add selectors to `_PRICE_SELECTORS` in `backend/scraper/engine.py`
4. **If the site is unusual:** add a `_try_<sitename>` strategy function and call it from `scrape()`

### Design decisions

| Decision | Rationale |
|---|---|
| Single shared Playwright browser | Saves ~200 MB RAM and 3–5 s startup per scrape |
| Scraping always in background tasks | API stays responsive; scraping blocks for 5–30 s |
| Sequential `scrape_all_active` | Polite scraping — avoids hammering target servers |
| SQLite over Postgres | Zero-config, single file, sufficient for personal use |
| No authentication | Local-only desktop app; backend binds to localhost |

---

## 📋 Changelog

### `v0.2.0` — 2026-04-13

> UI refresh, LKR currency, activity feed, categories

**Added**
- Activity feed with `change_type` classification (`price_up`, `price_down`, `stock_in`, `stock_out`, `new`, …)
- Categories with colour picker and chip filter on home screen
- `change_type`, `price_delta`, `previous_price`, `previous_stock_status` columns in `price_logs`
- `start_gabada.bat` — one-click Windows launcher

**Changed**
- Home scrape-all: auto-reloads every 10 s for 60 s — prices now update without manual refresh
- Per-store scrape: polls every 5 s (up to 35 s), dismisses snackbar when new data arrives
- All price displays: `$` → `Rs.` with comma-formatted integers

**Fixed**
- `WindowsProactorEventLoopPolicy` set before FastAPI import — Playwright subprocess errors on Windows resolved
- `BuildContext` captured before first `await` — `use_build_context_synchronously` lint resolved

---

### `v0.1.0` — 2026-04-12

> Initial release

**Added**
- FastAPI backend + Flutter Windows desktop frontend
- SQLite schema: `products`, `stores`, `product_stores`, `price_logs`
- 4-strategy Playwright scraper engine (JSON-LD · microdata · JS smart scan · CSS patterns)
- Custom `scrape_config` per product-store for manual selector overrides
- APScheduler daily auto-scrape at 08:00
- REST API: products, stores, logs, scraper, categories, activity, health
- Flutter screens: Home · ProductDetail · AddProduct · Activity
- Price history line chart with date-range filter
- Stock status badges and price change indicator icons

---

<div align="center">

<br/>

**[⬆ Back to top](#gabada)**

<br/>

Made with ❤️ using Flutter & FastAPI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

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
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111%2B-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Playwright](https://img.shields.io/badge/Playwright-1.44%2B-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

<br/>

*A local web app that watches product prices across any online store —
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
- Stealth Playwright context bypasses most Cloudflare / DataDome / bot-check walls
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
- Stock badges: In Stock · Limited · Pre-order · Backorder · Out of Stock
- Inline edit of product name / image / category from the detail screen
- One-click unlink of a store without deleting the product

</td>
<td width="50%">

**⚡ Automation**
- Daily auto-scrape at 08:00 via APScheduler
- Manual scrape from UI with live polling until results arrive
- REST API for scripting and integrations
- Zero config — drop in a URL and go

</td>
</tr>
<tr>
<td width="50%">

**💰 Dealer & Wholesale Prices**
- Extracts B2B / trade / dealer prices separately from retail prices
- Dedicated `dealer_price` field stored per scrape log
- `_DEALER_PRICE_SELECTORS` targets `.dealer-price`, `.trade-price`, `.your-price`, and more
- Custom `selectors.dealer_price` override for any store

</td>
<td width="50%">

**🚫 EMI / Instalment Filter**
- Automatically suppresses payment-plan and EMI prices
- Pattern matches: EMI, Easy Pay, Flexi Pay, `/month`, `×12 months`, Visa/Mastercard offers, and more
- Applied at the JS smart-scan stage **and** in Python — no instalment price ever leaks into logs
- Works transparently across all 4 scrape strategies

</td>
</tr>
<tr>
<td width="50%">

**✏️ Manual Overrides**
- Per-product-store `product_store_overrides` table
- Override `manual_price`, `manual_stock_status`, and add a freeform `override_note`
- Overrides surface in product summaries alongside scraped data
- Useful for stores that can't be scraped (PDFs, logins, private portals)

</td>
<td width="50%">

**📥 Bulk Import**
- **WooCommerce import** — enter site URL + API keys, preview the full product catalogue, tick what you want, import in one click
- **File import** — pick any CSV, Excel (`.xlsx`), or PDF; map Name / URL / Image columns; preview 5 sample rows before committing
- Auto-detects common column headers (name, url, image, title, permalink…)
- Powered by `openpyxl` (Excel) and `pdfplumber` (PDF); import button in home screen app bar

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                React + Vite SPA  (browser)               │
│   Home · ProductDetail · Activity · Add · Stores         │
│   Import · Probe · Settings                              │
│   TanStack Query · Tailwind v4 · Recharts · axios        │
└──────────────────────┬──────────────────────────────────┘
                       │  HTTP  localhost:8000
┌──────────────────────▼──────────────────────────────────┐
│                   FastAPI Backend                        │
│  /products  /stores  /logs  /scraper  /categories        │
│  /activity  /import  /settings  /health                  │
│  Static mount: frontend-web/dist  →  /                   │
│                     │                     │              │
│           aiosqlite │          APScheduler│              │
│           gabada.db │          cron-driven│              │
└──────────────────────┼─────────────────────┼────────────┘
                       │                     │
┌──────────────────────▼─────────────────────▼────────────┐
│                 Playwright Engine                        │
│  Strategy 1: JSON-LD structured data                     │
│  Strategy 2: Schema.org microdata                        │
│  Strategy 3: Universal JS smart scan  ← works anywhere   │
│  Strategy 4: CSS pattern library (Amazon/Shopify/etc.)   │
└─────────────────────────────────────────────────────────┘
```

**Stack at a glance:**

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite 8 · TypeScript · Tailwind v4 · TanStack Query · Zustand · React Router v7 · Recharts · axios |
| Backend | Python 3.11 · FastAPI · uvicorn · Pydantic v2 |
| Database | SQLite via aiosqlite (WAL mode, foreign keys) |
| Scraping | Playwright (Chromium) · APScheduler |
| Platform | Runs anywhere Python runs; UI is a browser SPA |

---

## ⚡ Quick Start

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | ≥ 3.11 | [python.org](https://python.org) |
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
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
cd ../frontend-web
npm install
npm run build          # produces frontend-web/dist — served by the backend
```

> Prefer hot-reload during development? Run `npm run dev` in a second terminal;
> Vite proxies `/api` to the FastAPI backend on port 8000.

### 4 · Launch

**Windows — one click:**

```
Double-click  start_gabada.bat
```

The backend starts and your browser opens at `http://localhost:8000/`.

**Manual (any OS):**

```bash
cd backend && uvicorn main:app --reload --port 8000
# then open http://localhost:8000/
```

### 5 · Verify

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

Open `http://localhost:8000/docs` for the interactive API explorer,
or just `http://localhost:8000/` for the UI.

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
 Navigate to URL (Playwright, headless Chromium, stealth context)
           │
           ▼
 ┌─────────────────────┐
 │  Bot-check wait     │  Detect Cloudflare / DataDome / PerimeterX challenge
 │                     │  pages and wait up to 25 s for auto-resolve
 └──────────┬──────────┘
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
    "dealer_price":      ".ty-price-dealer",
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
| `selectors.dealer_price` | `string` | `null` | CSS selector for B2B / trade / dealer price |
| `selectors.stock_status` | `string` | `null` | CSS selector for stock availability element |

> Custom selectors **override** auto-detected values for those fields only. Leave a field `null` to keep auto-detection for it.

> **EMI / instalment prices are automatically filtered.** If a selector accidentally targets a payment-plan price, the engine discards it. You do not need to work around this manually.

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
| `pre-order`, `preorder`, `pre-sale`, `coming soon`, `notify me` | `preorder` |
| `back-order`, `backorder`, `on backorder` | `backorder` |
| `out of stock`, `sold out`, `unavailable`, `not available` | `out_of_stock` |
| `limited`, `low stock`, `only X left`, `hurry`, `few left` | `limited` |
| `in stock`, `available`, `add to cart`, `buy now` | `in_stock` |
| Schema.org URL contains `PreOrder` / `PreSale` | `preorder` |
| Schema.org URL contains `BackOrder` | `backorder` |
| Schema.org URL contains `InStock` | `in_stock` |
| Schema.org URL contains `OutOfStock` | `out_of_stock` |
| Anything else / not found | `unknown` |

> Pre-order / back-order checks run **first** so sites that say "Available for pre-order / Add to cart" don't get misclassified as `in_stock`.

</details>

<details>
<summary><strong>Anti-bot / Cloudflare handling</strong></summary>

Every Playwright context is launched with a stealth init script plus realistic HTTP headers so fewer sites throw a challenge in the first place:

- `navigator.webdriver` returns `undefined`
- Spoofed `window.chrome`, `navigator.plugins`, `navigator.languages`, `hardwareConcurrency`, `deviceMemory`
- WebGL vendor / renderer spoofed to Intel
- Patched `Notification.permission` leak in `navigator.permissions.query`
- Realistic `Accept-Language`, `sec-ch-ua`, `sec-ch-ua-platform`, `Upgrade-Insecure-Requests` headers
- Timezone pinned to `Asia/Colombo`

On navigation, the engine detects running challenge pages (`#challenge-running`, `cf-challenge`, `iframe[src*="challenges.cloudflare.com"]`, `px-captcha`, or body text like "Just a moment", "Verifying you are human", "Checking your browser") and waits up to 25 s for the challenge to auto-resolve before extracting.

Sites that require human-solved CAPTCHAs (Turnstile interactive, hCaptcha, etc.) still cannot be scraped headlessly. For logged-in scraping, use the `/scraper/login-session` endpoint to save `storage_state.json` and reference it via `scrape_config.storage_state_path`.

</details>

<details>
<summary><strong>Reverse-price / "was" price detection</strong></summary>

Sites that show two prices (original + discounted) don't always mark the original with `<del>`, `<s>`, or `line-through`. The smart scan uses two signals to pick which value is the retail and which is the sale price:

1. **STRIKE regex** — matches on class names/IDs like `retail`, `was`, `original`, `old-price`, `price-old`, `was-price`, `price-was`, `sale-was`, `mrp`, `rrp`, `msrp`, `list-price`, `compare-price`, `line-through`, `strikethrough`, `previous-price`.
2. **Sale-signal proximity fallback** — when no candidate is marked struck, the scanner picks the largest non-dealer, non-installment price that is ≥5% higher than the main and sits near visible text like `was`, `save`, `regular`, `rrp`, `mrp`, `you save`, or a `% off` badge within 4 ancestor elements.

Convention across the codebase: `price` = original / retail (higher), `discounted_price` = current sale (lower). The UI shows the discounted price in bold when present and the original struck through.

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

### Manual Overrides

Override scraped data for a specific product-store link — useful for stores that can't be scraped.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/products/{id}/stores/{ps_id}/override` | Get current override (404 if none) |
| `PUT` | `/products/{id}/stores/{ps_id}/override` | Create or replace override |
| `DELETE` | `/products/{id}/stores/{ps_id}/override` | Remove override |

```bash
# Set a manual price + note
curl -X PUT http://localhost:8000/products/3/stores/7/override \
  -H "Content-Type: application/json" \
  -d '{"manual_price": 149900, "manual_stock_status": "in_stock", "override_note": "Checked PDF catalog 2026-04-13"}'
```

### WooCommerce Import

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/import/woo/preview` | Fetch product list from WooCommerce (no DB writes) |
| `POST` | `/import/woo/import` | Import selected products + create store links |

**Request body — preview:**
```json
{
  "credentials": {
    "site_url": "https://myshop.example.com",
    "consumer_key": "ck_xxxx",
    "consumer_secret": "cs_xxxx"
  },
  "per_page": 50,
  "page": 1
}
```

**Request body — import:**
```json
{
  "credentials": { "site_url": "...", "consumer_key": "...", "consumer_secret": "..." },
  "store_id": 3,
  "product_ids": [101, 204, 317]
}
```

```bash
# Preview
curl -X POST http://localhost:8000/import/woo/preview \
  -H "Content-Type: application/json" \
  -d '{"credentials":{"site_url":"https://myshop.example.com","consumer_key":"ck_xxxx","consumer_secret":"cs_xxxx"},"per_page":50}'

# Import selected
curl -X POST http://localhost:8000/import/woo/import \
  -H "Content-Type: application/json" \
  -d '{"credentials":{...},"store_id":3,"product_ids":[101,204,317]}'
# → {"imported": 3}
```

> Requires a WooCommerce store with the REST API enabled. Generate keys at **WP Admin → WooCommerce → Settings → Advanced → REST API**.

### File Import (CSV / Excel / PDF)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/import/file/preview` | Upload file → returns columns + 5 sample rows (no DB writes) |
| `POST` | `/import/file/commit` | Commit mapped rows → creates products + store links |

**Supported formats:** `.csv`, `.xlsx`, `.xls`, `.pdf` (PDF must contain a table)

```bash
# Step 1 — preview
curl -X POST http://localhost:8000/import/file/preview \
  -F "file=@products.csv"
# → {"columns":["Product Name","Store URL","Image"],"sample_rows":[...],"total_rows":120,"file_format":"csv"}

# Step 2 — commit (map columns by index: name=0, url=1, image=2)
curl -X POST http://localhost:8000/import/file/commit \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      {"name": "AMD Ryzen 9 9950X", "url": "https://store.lk/ryzen9950x", "image_url": null}
    ],
    "store_id": 2,
    "category_id": 1
  }'
# → {"imported": 1}
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

product_stores                      product_store_overrides
──────────────                      ───────────────────────
id PK                               id PK
product_id ──▶ products             product_store_id ──▶ product_stores (UNIQUE)
store_id   ──▶ stores               manual_price
product_url                         manual_stock_status
scrape_config (JSON)                override_note
is_active                           updated_at
created_at

price_logs
──────────
id PK
product_store_id ──▶ product_stores
scraped_at
title
price              ← original/retail
discounted_price   ← sale/current
dealer_price       ← B2B / trade price
stock_status
raw_price
raw_discounted
raw_dealer
change_type
price_delta
previous_price
previous_stock_status
```

> **Effective price:** `COALESCE(discounted_price, price)` gives the price the customer actually pays. When no discount is active, `discounted_price` is `NULL` and `price` holds the current price.

> **Dealer price:** Stored separately in `dealer_price`. Never substituted for the retail price — kept as supplementary data for B2B comparison.

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
<summary><strong>"Cannot reach backend" in the UI</strong></summary>

1. Confirm backend is running: `curl http://localhost:8000/health` → `{"status":"ok"}`
2. Confirm port 8000 is not blocked by your firewall
3. Ensure you launched from the `backend/` directory, not the repo root
4. In dev mode, confirm the Vite proxy is targeting `http://localhost:8000`

</details>

<details>
<summary><strong>Scrape returns no price (price = —)</strong></summary>

| Cause | Fix |
|---|---|
| Site uses JS and `use_playwright` is `false` | Set `"use_playwright": true` |
| SPA renders price after load | Add `"wait_for": "<price-selector>"` |
| Unusual price format or layout | Add `"selectors": {"price": "..."}` |
| `wait_timeout` too short | Increase to `30000` (30 s) |
| Interactive CAPTCHA (Turnstile / hCaptcha) | Use `/scraper/login-session` to save a logged-in `storage_state.json`, then set `scrape_config.storage_state_path` |
| Cloudflare / DataDome auto-challenge | Handled automatically — if it still fails, bump `wait_timeout` or try again later |

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
<summary><strong>Frontend: build or type errors</strong></summary>

```bash
cd frontend-web
npm install
npx tsc -b --pretty false   # shows any remaining type issues
npm run build
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

# 4. Develop — frontend hot-reload (second terminal)
cd frontend-web && npm run dev
# Vite serves at http://localhost:5173 and proxies /api to port 8000

# 5. Lint
pip install ruff && ruff check backend/
cd frontend-web && npx tsc -b --pretty false

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
| No authentication | Designed to run locally; backend binds to localhost |

---

## 📋 Changelog

### `v0.5.0` — 2026-04-18

> Bot-check bypass, pre-order / back-order, reverse-price fix, edit UI

**Added**
- **Playwright stealth init script** on every context — masks `navigator.webdriver`, spoofs `chrome`, `plugins`, `languages`, `hardwareConcurrency`, WebGL vendor/renderer; sends realistic `Accept-Language` and `sec-ch-ua` headers
- **Cloudflare / DataDome challenge handler** — detects `#challenge-running`, `cf-challenge`, `iframe[src*="challenges.cloudflare.com"]`, `px-captcha`, and body phrases like "Just a moment" / "Verifying you are human"; waits up to 25 s for auto-resolve
- `preorder` and `backorder` recognised by `_parse_stock`, Schema.org availability URLs, and the smart-scan JS (button text + body text)
- `info` badge variant (sky/tint); `StockPill` now labels Pre-order and Backorder
- **Edit product** button + inline form on the detail screen — updates `canonical_name`, `image_url`, `category_id` via `PATCH /products/{id}`
- **Unlink store** trash icon on every `StoreRow` — calls `DELETE /products/{id}/stores/{ps_id}`
- `NoCacheHTMLStaticFiles` mount sends `Cache-Control: no-store` for the SPA entry HTML so newly built bundles load without a hard refresh

**Fixed**
- **Reverse-price bug** (e.g. MD store showing 144 000 sale from 206 000 retail):
  - STRIKE regex in the smart scan now also matches `mrp`, `rrp`, `msrp`, `old-price`, `price-old`, `was-price`, `price-was`, `sale-was`, `line-through`, `strikethrough`, `previous-price`
  - New sale-signal proximity fallback picks a non-dealer price ≥5 % higher than the main when it sits near `was`, `save`, `regular`, `rrp`, `mrp`, `you save`, or a `% off` badge within 4 ancestor elements
- Pre-order / back-order checks run before `in_stock` so "Available for pre-order" pages no longer fall through to `in_stock`

---

### `v0.4.0` — 2026-04-13

> Import screen, override endpoints wired end-to-end, store summary fixes

**Added**
- **Import screen** (Flutter) — upload icon in home app bar; two tabs:
  - _WooCommerce tab_: credentials form → product preview list with checkboxes → Import Selected
  - _File Import tab_: file picker (CSV / Excel / PDF) → column auto-detect → sample data table → Import
- `POST /import/woo/preview` and `POST /import/woo/import` — WooCommerce REST API integration
- `POST /import/file/preview` and `POST /import/file/commit` — CSV / Excel / PDF file import
- `PUT /products/{id}/stores/{ps_id}/override` — create or replace manual price/stock override
- `DELETE /products/{id}/stores/{ps_id}/override` — clear override
- `file_picker ^8.1.2` Flutter dependency for native file picker dialog

**Fixed**
- `_get_store_summaries` now joins `price_logs.dealer_price` and `product_store_overrides` — dealer prices and manual overrides now actually appear in the Flutter UI after a scrape

---

### `v0.3.0` — 2026-04-13

> Dealer prices, EMI filtering, manual overrides, WooCommerce & file import

**Added**
- `dealer_price` / `raw_dealer` columns in `price_logs` — B2B / trade prices scraped separately
- `_DEALER_PRICE_SELECTORS` list targeting `.dealer-price`, `.trade-price`, `.wholesale-price`, `.your-price`, and CS-Cart's `.ty-price-dealer`
- `selectors.dealer_price` field in `ScrapeConfig` for custom dealer price override
- `_INSTALLMENT_RE` regex filter — suppresses EMI, Easy Pay, Flexi Pay, `/month`, `×12 months`, card-offer prices across all 4 scrape strategies
- `product_store_overrides` table — manual `manual_price`, `manual_stock_status`, `override_note` per product-store
- `ProductStoreOverride` / `ProductStoreOverrideUpsert` Pydantic models
- WooCommerce import models: `WooCredentials`, `WooProductPreview`, `WooPreviewRequest`, `WooImportRequest`
- File import models: `FileImportPreviewResponse`, `FileImportRow`, `FileImportCommitRequest`
- `openpyxl` and `pdfplumber` dependencies (Excel + PDF file import)

---

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

Made with ❤️ using React & FastAPI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

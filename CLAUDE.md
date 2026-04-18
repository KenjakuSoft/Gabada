# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Gabada** — a product price & stock tracker. Scrapes product listings from online shops (both static HTML and JS-heavy SPAs), logs price and stock status daily, and displays history with charts and a calendar picker.

## Architecture

```
Gabada/
├── backend/           ← Python: scraping, storage, REST API, static UI host
│   ├── main.py        ← FastAPI entry (uvicorn) + StaticFiles mount of built UI
│   ├── database/      ← SQLite schema + async queries (aiosqlite)
│   ├── scraper/       ← Playwright-based scraper engine
│   ├── api/           ← Route handlers (products, stores, logs, scraper, import, settings)
│   └── scheduler/     ← APScheduler auto-scrape jobs
└── frontend-web/      ← React + Vite SPA (served by backend from dist/)
    └── src/
        ├── pages/     ← Home, ProductDetail, AddProduct, Stores, Import, Probe, Activity, Settings
        ├── components/← ui/ primitives, layout/, products/, import/
        ├── api/       ← axios client + typed endpoint modules
        ├── hooks/     ← useSettings, useApplyTheme, etc.
        ├── store/     ← Zustand theme store
        └── lib/       ← formatters and utilities
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
**UI:** served at `http://localhost:8000/` when `frontend-web/dist` exists.

## Frontend

**Stack:** React 19 · Vite 8 · TypeScript · Tailwind v4 (CSS-first) · TanStack Query · Zustand · React Router v7 · Recharts · axios

**Run dev server (hot reload, proxies `/api` → backend):**
```bash
cd ~/Desktop/Gabada/frontend-web
npm install
npm run dev
```

**Build production bundle (served by backend):**
```bash
npm run build   # → frontend-web/dist
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
- Frontend calls the backend only through `src/api/` modules — never raw axios/fetch in components
- Server state lives in TanStack Query; UI-only state in Zustand or local `useState` — never duplicate server state into a store

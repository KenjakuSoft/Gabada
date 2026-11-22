<div align="center">

# 📦 Gabada

**Your personal price & stock tracker.**

Keep an eye on the prices of the things you buy — across any online store, on your own computer.

<img alt="Latest release" src="https://img.shields.io/badge/release-v0.7.6-2F80ED?style=for-the-badge">
<img alt="Release workflow" src="https://img.shields.io/badge/release%20workflow-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white&style=for-the-badge">
<img alt="License" src="https://img.shields.io/badge/license-MIT-34A853?style=for-the-badge">

<br/>

<img alt="Python 3.11+" src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white&style=flat-square">
<img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-API-009688?logo=fastapi&logoColor=white&style=flat-square">
<img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111&style=flat-square">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-UI-3178C6?logo=typescript&logoColor=white&style=flat-square">
<img alt="Playwright" src="https://img.shields.io/badge/Playwright-scraper-2EAD33?logo=playwright&logoColor=white&style=flat-square">
<img alt="SQLite" src="https://img.shields.io/badge/SQLite-local%20database-003B57?logo=sqlite&logoColor=white&style=flat-square">
<img alt="Windows Linux macOS" src="https://img.shields.io/badge/Windows%20%7C%20Linux%20%7C%20macOS-supported-444?style=flat-square">

<br/>

[Quick Start](#quick-start) · [What it does](#what-is-gabada) · [Features](#features) · [How scraping works](#how-scraping-works) · [Imports](#importing-your-products) · [Architecture](#architecture) · [Troubleshooting](#troubleshooting) · [Changelog](./CHANGELOG.md)

</div>

---

## What is Gabada?

Gabada is a **free, local-first tool that watches product prices and stock for you.**

Say you're shopping for a laptop, a console, or a motherboard. Instead of opening ten store tabs every day, you add the product pages once and Gabada keeps track:

- **Sees the price** on each store automatically, including sale prices and logged-in "dealer" pricing.
- **Tells you when it changes** — a price drop, a jump, or a "back in stock."
- **Keeps history**, so you can see how a price moved over weeks.
- **Converts currencies** so you can compare stores that price in different currencies.

Everything runs **on your machine** — your data stays in a local database. No account, no cloud, no tracking. It's a little like a price-tracking feed you own yourself.

> **In one line:** Gabada is a self-hosted price-drop and stock-watch app that scrapes the stores you care about and shows you what changed.

### Who it's for

| If you're… | Gabada helps you… |
| --- | --- |
| A shopper | Catch price drops and sales before they pass, and spot "back in stock" items. |
| A dealer / reseller | Track wholesale or logged-in dealer prices across suppliers. |
| A developer | Automate price scraping, import catalogs, and extend it with your own feeds and selectors. |

---

## At a glance

| Local-first | Scraper-aware | Release-ready |
| --- | --- | --- |
| Your data lives in SQLite on your computer. | Reads prices from most store pages automatically, with tools to fix tricky ones. | Ships as a Windows installer or portable bundles for Windows, Linux, and macOS. |

---

## Quick Start

### 1. Get the code

```powershell
git clone https://github.com/KenjakuSoft/Gabada.git
cd Gabada
```

### 2. Set up the backend

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

### 3. Build the frontend

```powershell
cd ..\frontend-web
npm.cmd install
npm.cmd run build
```

### 4. Run it

**Windows:** double-click [`start_gabada.bat`](./start_gabada.bat) (console) or [`Start Gabada.vbs`](./Start%20Gabada.vbs) (quiet). To stop it, run [`Stop Gabada.bat`](./Stop%20Gabada.bat).

**Linux / macOS:**

```bash
chmod +x start_gabada.sh stop_gabada.sh
./start_gabada.sh
./stop_gabada.sh
```

The launcher picks a free localhost port (8000–8010), waits for the app to be ready, and opens it in your browser. It also has a [desktop-style launcher](./backend/desktop_launcher.py).

**Manual backend run** (developer):

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Open the app at <http://127.0.0.1:8000>, API docs at <http://127.0.0.1:8000/docs>, or the health check at <http://127.0.0.1:8000/health>. If the app page is empty, make sure you ran `npm.cmd run build` in `frontend-web` first.

---

## Features

**Track and compare**
- Track one product across many stores.
- Save regular price, sale price, dealer price, stock status, warranty text, and full scrape history.
- Compare current store prices side by side on the Home and Product pages.
- Organize products into categories.
- Tag each price with its source currency (`Rs/LKR`, `USD`, `EUR`, …) with optional currency conversion in the UI.

**Stay informed**
- Browse the Activity feed — see every price drop, spike, and stock change with collapsible per-product/per-store views.
- Human-readable change labels ("Price up", "Back in stock", "First scrape") instead of raw codes.

**Import your catalog**
- Import from WooCommerce, CSV, XLSX, XLS, and PDF.
- Import from store APIs (Steam, Apple App Store, GOG, and a Custom JSON template for PlayStation, Xbox, Epic, EA Play, Ubisoft, Nintendo, Apple Store, Google Play).
- Preview imports, map columns, target existing products, and commit only the rows you want.
- Optionally auto-add new WooCommerce / API catalog products on future syncs.

**Fix tricky pages**
- **Probe** inspects what the scraper sees and why it picked a value.
- **Selector Lab** lets you pin exact selectors, test them, and save a reusable profile per store.
- **Bot challenges** (Cloudflare, DataDome, Turnstile) are auto-bypassed via a stealth Chrome fallback — no per-site setup needed.
- Capture **per-store login sessions** for sites that show prices only after signing in.

**Back up and go anywhere**
- Export/import backup bundles containing your database and scraper profiles.
- Push and restore manual **Google Drive** snapshots from Settings.
- Check for new GitHub Releases from Settings and open the recommended update.

---

## How scraping works

Gabada reads a product page using a layered approach — it tries the most trustworthy signals first, then falls back to smarter guesses:

1. **Facebook Marketplace fast path** for Marketplace item URLs.
2. **JSON-LD** structured product data (the site's own machine-readable info).
3. **Schema.org microdata.**
4. **OpenGraph / Twitter product meta tags.**
5. **Smart page scan** with filters that ignore installment / "per month" amounts and model-number noise.
6. **Common CSS patterns** and saved per-store profiles.

It auto-detects platforms (CS-Cart, WooCommerce, Shopify, Magento, PrestaShop, OpenCart, BigCommerce, Wix Stores, Squarespace) and applies sensible default selectors. Structured-data hits are treated as the strongest signal, and the review step guards against stray page text ever replacing a real product price.

**Three price concepts are tracked separately:**

| Field | Meaning |
| --- | --- |
| `price` | The regular / original / non-sale price. |
| `discounted_price` | The current sale price (usually paired with a strikethrough original). |
| `dealer_price` | Wholesale, trade, or logged-in dealer price when a store exposes one. |

On sale pages the UI shows `discounted_price` as the price you'd actually pay. On Facebook Marketplace, dealer pricing is suppressed (there's no wholesale concept there).

### Bot-challenge fallback

When the built-in headless browser hits a Cloudflare / DataDome / Turnstile check that won't clear on its own, Gabada retries the scrape through a SeleniumBase stealth Chrome — it navigates first, solves the checkbox automatically, then Playwright reads the cleared page. A small Chrome window may flash for ~10 seconds; that's normal. If there's no installed Chrome or the site still blocks automation, the scrape returns a "needs review" result instead of crashing.

---

## Importing your products

### WooCommerce

- Preview the catalog before importing, and fetch past the first page.
- Select only the products you want.
- Save credentials on a store and optionally auto-add new products on future syncs.

### Store APIs

| Provider | Auth | Notes |
| --- | --- | --- |
| Steam | none | Public storefront API |
| Apple App Store | none | iTunes lookup API |
| GOG | none | Public catalog API |
| Custom JSON | configurable | Template for PlayStation, Xbox, Epic, EA Play, Ubisoft, Nintendo, Apple Store, Google Play, and any JSON feed |

API-enabled stores skip the browser entirely on the daily scrape — they pull prices over HTTP, which is faster, more reliable, and avoids bot protection.

### Documents

Upload **CSV**, **XLSX**, **XLS**, or **PDF** and map product name, URL, image, regular price, sale price, dealer price, warranty, and stock fields. Rows without a live URL can be kept as inactive store links for price-list–style tracking.

---

## Backing up and syncing

- **Manual backup:** `Settings → Backup, restore, and share` exports an archive (database + profiles + metadata). Import makes a safety copy first. Plain `.db`/`.sqlite`/`.sqlite3` files can also be imported.
- **Google Drive:** push/restore manual snapshots into a `Gabada` folder in your Drive (uses the `drive.file` scope). It's not live two-way sync — a sensible workflow is *restore newest → edit → push new snapshot* on each device.

---

## Requirements

| Tool | Version |
| --- | --- |
| Python | 3.11 or newer |
| Node.js | 20 or newer |
| Git | Any recent version |
| Google Chrome | Latest (only for the bot-challenge stealth fallback) |

Playwright downloads its own Chromium during setup. If the system Chrome is missing, the scraper still boots — bot-challenge sites just return a "needs review" result.

---

## Development

Run the backend and frontend separately for hot reload.

**Terminal 1 — backend:**

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend:**

```powershell
cd frontend-web
npm.cmd run dev
```

The Vite dev server runs at <http://127.0.0.1:5173> and proxies `/api` to the backend at <http://127.0.0.1:8000>.

**Verification:**

```powershell
# backend
cd backend
.\.venv\Scripts\python.exe -m pytest -q

# frontend
cd frontend-web
npm.cmd run lint
npm.cmd run build
```

---

## Architecture

```text
Gabada/
  backend/
    api/                 FastAPI routers mounted under /api
    database/            SQLite setup and Pydantic models
    scheduler/           APScheduler daily scrape job
    scraper/             Playwright scraper engine, sites.toml profiles, and SeleniumBase stealth fallback
    services/            Backup bundle, Google Drive sync, and API catalog import providers
    app_paths.py         Dev vs frozen path resolution
    desktop_launcher.py  Local desktop-style launcher
    main.py              FastAPI entry point
  frontend-web/
    src/                 React 19, TypeScript, Tailwind v4
    package.json
  packaging/
    gabada.spec          PyInstaller spec
    build_release.sh     Linux/macOS portable release build
    windows/             Windows installer build and Inno Setup config
  .github/workflows/
    release.yml          Multi-platform release workflow
```

| Layer | Technology |
| --- | --- |
| Backend | FastAPI, Uvicorn, Playwright, SeleniumBase (optional, stealth fallback), APScheduler, aiosqlite, Pydantic v2 |
| Frontend | React 19, Vite 8, TypeScript, Tailwind v4, TanStack Query, Zustand, Recharts |
| Database | SQLite in WAL mode |
| Packaging | PyInstaller and Inno Setup |

### Runtime data

Development builds store data in `backend/`. Installed builds store it under the platform app-data folder:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\Gabada` |
| macOS | `~/Library/Application Support/Gabada` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/Gabada` |

Data includes `gabada.db`, `sites.toml`, `sessions/`, `logs/`, `backups/`, and Drive credentials when Drive sync is configured.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `GABADA_DATA_DIR` | Override the user data directory (testing, separate libraries). |
| `GABADA_NO_BROWSER` | `1`/`true`/`yes` to stop the launcher opening a browser. |
| `GABADA_ALLOWED_ORIGINS` | Comma-separated extra browser origins allowed to call the local API. |
| `PLAYWRIGHT_BROWSERS_PATH` | Set automatically in bundled builds. |

---

## API

The API lives under `/api`, with interactive docs at `/docs` when running.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe |
| `GET` | `/api/products/` | List products |
| `GET` | `/api/stores/` | List stores |
| `GET` | `/api/categories/` | List categories |
| `POST` | `/api/scraper/probe` | Run scrape diagnostics |
| `POST` | `/api/scraper/selector-lab` | Discover selector candidates |
| `POST` | `/api/scraper/selector-lab/test` | Test selected selectors |
| `PUT` | `/api/scraper/selector-lab/profile` | Save a domain profile |
| `POST` | `/api/scraper/scrape/{product_store_id}` | Scrape one active store link |
| `POST` | `/api/scraper/scrape-all` | Scrape every active store link |
| `POST` | `/api/import/api/preview` | Preview API catalog products |
| `POST` | `/api/import/api/import` | Import selected API catalog products |
| `GET` | `/api/settings/database/export` | Download backup archive |
| `POST` | `/api/settings/database/import` | Restore backup archive or database |
| `POST` | `/api/drive/snapshots/push` | Upload Drive snapshot |
| `POST` | `/api/drive/snapshots/restore/{id}` | Restore Drive snapshot |

---

## Local API security

Gabada is a local desktop-style app, not a hosted multi-user service. Every `/api/*` request is defended against browser-based attacks:

- **Origin allowlist** — only trusted local origins (localhost / 127.0.0.1 on ports 5173 and 8000–8010) can call the API. Add more with `GABADA_ALLOWED_ORIGINS`.
- **Host header validation** — requests whose `Host` doesn't point at a loopback interface on an allowed port are rejected, blocking DNS-rebinding.
- **`Sec-Fetch-Site` allowlist** — only `same-origin`, `same-site`, and `none` are accepted.
- **Security headers on every response** — `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` lockdown for camera/mic/geolocation.
- **Path confinement** — login-session and probe storage paths are confined to the Gabada sessions directory; absolute paths and `..` escapes are rejected.
- **URL scheme allowlist** — scraper inputs accept only `http://` and `https://` (no `file://`, `javascript:`, `data:`).

---

## Packaging and releases

**Windows installer + portable zip:**

```powershell
cd packaging\windows
.\build_installer.ps1
```

**Linux/macOS portable tarball:**

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
./packaging/build_release.sh --app-version 0.7.6
```

Pushing a `v*` tag (or publishing a GitHub Release) triggers [release.yml](./.github/workflows/release.yml), which builds Windows, Linux, and macOS artifacts and uploads them to the release:

| Platform | Artifact |
| --- | --- |
| Windows | `GabadaSetup-<tag>-windows-x64.exe`, `Gabada-<tag>-windows-x64.zip` |
| Linux | `Gabada-<tag>-linux-x64.tar.gz` |
| macOS | `Gabada-<tag>-macos-arm64.tar.gz` |

Each release also writes an update manifest (`gabada-update-<tag>-<platform>-<arch>.json`). The Settings page uses GitHub Releases to compare the running version with the newest release and recommend the matching update.

---

## Troubleshooting

**Uvicorn command fails** — run it from inside `backend` with the venv Python. If `.venv` is missing, create it and `pip install -r requirements.txt` first.

**Probe / Selector Lab picks the wrong price** — check whether the value is really a sale, regular, or dealer price (or just page noise). Probe shows the candidates and review notes; Selector Lab lets you pin stronger selectors; save the profile for the domain and rescrape.

**A page shows a strikethrough price** — map the original to `price` and the current sale to `discounted_price`. The UI uses the discounted value as the effective price when present.

**Drive sign-in hangs** — cancel in Settings, verify the Google Cloud OAuth client is a *Desktop* client, confirm the Drive API is on, and retry.

**A Chrome window opens and the cursor moves on its own** — that's the stealth fallback solving a Cloudflare/Turnstile challenge. Don't move the mouse during the ~10s click window. If challenges consistently aren't bypassed, update SeleniumBase:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install --upgrade seleniumbase
```

Gabada still boots without SeleniumBase — bot-challenge sites just return a "needs review" result.

**The app opens but the frontend is missing** — build it:

```powershell
cd frontend-web
npm.cmd run build
```

Then restart the backend or launcher.

---

## License

Gabada is released under the [MIT License](./LICENSE).
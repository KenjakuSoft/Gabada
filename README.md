<h1 align="center">Gabada</h1>

<p align="center">
  <strong>Local-first price and stock tracking for products across online stores.</strong>
</p>

<p align="center">
  <a href="https://github.com/KenjakuSoft/Gabada/releases/latest"><img alt="Latest release" src="https://img.shields.io/badge/release-v0.7.3-2F80ED?style=for-the-badge"></a>
  <a href="https://github.com/KenjakuSoft/Gabada/actions/workflows/release.yml"><img alt="Release workflow" src="https://img.shields.io/badge/release%20workflow-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white&style=for-the-badge"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-34A853?style=for-the-badge"></a>
</p>

<p align="center">
  <img alt="Python 3.11+" src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white&style=flat-square">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-API-009688?logo=fastapi&logoColor=white&style=flat-square">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111&style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-UI-3178C6?logo=typescript&logoColor=white&style=flat-square">
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-scraper-2EAD33?logo=playwright&logoColor=white&style=flat-square">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local%20database-003B57?logo=sqlite&logoColor=white&style=flat-square">
  <img alt="Windows Linux macOS" src="https://img.shields.io/badge/Windows%20%7C%20Linux%20%7C%20macOS-supported-444?style=flat-square">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>
  |
  <a href="#features">Features</a>
  |
  <a href="#scraping-model">Scraping Model</a>
  |
  <a href="#import-workflow">Imports</a>
  |
  <a href="#packaging-and-releases">Releases</a>
  |
  <a href="./CHANGELOG.md">Changelog</a>
</p>

Gabada runs a FastAPI backend, a React web UI, Playwright-powered scraping, and a
SQLite database on your own machine. It is built for comparing store prices,
keeping historical price logs, importing catalogs, and repairing scraper results
when a site layout changes.

| Local-first | Scraper-aware | Release-ready |
| --- | --- | --- |
| Data stays on your machine in SQLite. | JSON-LD, microdata, smart scan, custom selectors, and Selector Lab profiles. | Windows installer, portable bundles, update checks, and GitHub Release workflow. |

## Current Release

Latest stable release: `v0.7.3`

Recent highlights:

- **Price changes now match across every ingestion path.** Scraping, file imports, and API catalog sync share one classifier, so a sale price, a stock flip, or a first-seen price gets the same label no matter how the data arrived.
- **Cleaner price history.** Sub-cent float noise is no longer logged as a price move, the first real price after a "call for price" page is logged as "new" rather than "price up", and same-second logs resolve deterministically to the newest row.
- **Clearer manual scrapes and input limits.** A scrape that legitimately finds no price returns a skipped summary instead of `409`, and logs/activity reject non-positive limits with `422`.
- **Safer settings and store management.** One corrupt exchange rate no longer wipes the rest, non-finite rates are rejected, and deleting a store removes its saved login-session file.
- **Tighter product links.** Missing products, duplicate store links, and cross-product override access now return proper `404`/`409` responses instead of database errors or silent writes.
- **UI polish.** Human-readable change labels in the logs table, a fixed logs API client, and a count-up animation that resumes from the value on screen.
- Earlier in the 0.7.x line: meta-tag extraction, OpenCart/BigCommerce/Wix/Squarespace fingerprints, modern SeleniumBase Turnstile support, ~48 currencies, and client-rendered Next.js storefront support.

See [CHANGELOG.md](./CHANGELOG.md) for full release notes.

## Features

- Track one product across many stores.
- Save price, discounted price, dealer price, stock status, warranty text, and scrape history.
- Tag every price log row with the source currency parsed from the page (`Rs/LKR`, `USD`, `EUR`, `GBP`, `INR`, `JPY`, ISO codes), with optional exchange-rate conversion in the UI.
- Compare current store prices from the Home and Product Detail pages.
- Browse the Activity feed with collapsible per-product and per-store dropdowns, plus Expand-all / Collapse-all controls and search-driven auto-expand.
- Organize products by category.
- Import products from WooCommerce, CSV, XLSX, XLS, and PDF.
- Import from store APIs (built-in Steam, Apple App Store, GOG; Custom JSON template for PlayStation, Xbox, Epic, EA Play, Ubisoft, Nintendo, Apple Store, Google Play). API-enabled stores sync via HTTP and skip Playwright entirely.
- Preview imports, map columns, target existing products, and commit selected rows.
- Sync WooCommerce catalogs before scheduled scrapes and optionally auto-add new catalog products.
- Use Probe to inspect what the scraper sees before saving a profile.
- Use Selector Lab to assign selectors, test them, and save reusable domain profiles.
- Auto-bypass Cloudflare / DataDome / Turnstile bot challenges via a SeleniumBase stealth Chrome fallback (no per-site config required).
- Capture per-store login sessions for sites that show prices only after sign-in.
- Export and import backup bundles containing the database and scraper profiles.
- Push and restore manual Google Drive snapshots from the Settings page.
- Check for new GitHub Releases from Settings and open the recommended update asset.
- Run as a local web app, a desktop-style launcher, or a packaged desktop build.

## Price Fields

Gabada stores multiple price concepts because many store pages show sale pricing:

| Field | Meaning |
| --- | --- |
| `price` | Regular, original, or non-sale price. |
| `discounted_price` | Current sale price, usually paired with a strikethrough original price. |
| `dealer_price` | Wholesale, trade, or logged-in dealer price when the store exposes one. |

For sale pages, the UI treats `discounted_price` as the effective current price.
For Facebook Marketplace, dealer pricing is suppressed because marketplace listings
do not have a wholesale/dealer concept.

## Requirements

| Tool | Version |
| --- | --- |
| Python | 3.11 or newer |
| Node.js | 20 or newer |
| Git | Any recent version |
| Google Chrome | Latest (only required for the bot-challenge stealth fallback) |

Playwright downloads its own Chromium browser during setup. The
SeleniumBase stealth fallback uses your installed system Chrome — on
Windows desktops Chrome is usually already present. If it is missing,
the scraper still boots and bot-challenge sites simply fall back to the
existing `needs_review` result.

## Quick Start

### Clone

```powershell
git clone https://github.com/KenjakuSoft/Gabada.git
cd Gabada
```

### Backend Setup

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

### Frontend Setup

```powershell
cd ..\frontend-web
npm.cmd install
npm.cmd run build
```

### Run On Windows

Double-click:

- [start_gabada.bat](./start_gabada.bat) for a console launcher
- [Start Gabada.vbs](./Start%20Gabada.vbs) for a quiet launcher

The launcher starts `backend/desktop_launcher.py`, picks a free localhost port
from `8000` to `8010`, waits for `/health`, and opens the app in your browser.

To stop it, run [Stop Gabada.bat](./Stop%20Gabada.bat).

### Run On Linux Or macOS

```bash
chmod +x start_gabada.sh stop_gabada.sh
./start_gabada.sh
./stop_gabada.sh
```

### Manual Backend Run

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Open:

- App: <http://127.0.0.1:8000>
- API docs: <http://127.0.0.1:8000/docs>
- Health: <http://127.0.0.1:8000/health>

If the backend starts but the app page is empty, build the frontend first:

```powershell
cd frontend-web
npm.cmd run build
```

## Development

Run backend and frontend separately for hot reload.

Terminal 1:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Terminal 2:

```powershell
cd frontend-web
npm.cmd run dev
```

The Vite dev server runs at <http://127.0.0.1:5173> and proxies `/api` to
the backend at <http://127.0.0.1:8000>.

## Verification

Backend:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
cd frontend-web
npm.cmd run lint
npm.cmd run build
```

Quick Python compile check:

```powershell
cd backend
$files = Get-ChildItem -Path . -Recurse -Filter *.py |
  Where-Object { $_.FullName -notmatch '\\.venv\\|\\__pycache__\\' } |
  ForEach-Object { $_.FullName }
.\.venv\Scripts\python.exe -m py_compile @files
```

## Scraping Model

The scraper uses layered extraction:

1. Facebook Marketplace fast path for Marketplace item URLs.
2. JSON-LD structured product data.
3. Schema.org microdata.
4. OpenGraph / Twitter product meta tags.
5. Deterministic smart page scan with installment and payment-method filters.
6. Common selectors and saved per-domain profiles.

Platform auto-detect recognizes CS-Cart, WooCommerce, Shopify, Magento,
PrestaShop, OpenCart, BigCommerce, Wix Stores, and Squarespace, and applies
sensible default selectors for each.

Structured-data hits are treated as strong signals. The review step can surface
an alternative candidate when smart scan disagrees, but extreme mismatches are
guarded so small stray text fragments do not replace real product prices.

Manual scrape endpoints wait until the scrape finishes and then return the real
status. The UI refreshes product data after completion instead of immediately
after queueing.

### Bot Challenge Fallback

When the shared headless Chromium hits a Cloudflare interstitial,
DataDome challenge, or Turnstile checkbox that does not auto-clear,
Gabada retries the same scrape once through a SeleniumBase-launched
stealth Chrome via Playwright's `connect_over_cdp()`. SeleniumBase
navigates first so its anti-bot warmup runs, then the captcha
auto-clicker solves the Turnstile checkbox — `tab.solve_captcha()` on
SeleniumBase 4.50+, with the legacy `uc_gui_*` pyautogui helpers kept
as fallbacks for older installs. Playwright then attaches and reads
the already-cleared page.

A visible Chrome window flashes for ~10 seconds during the bypass —
required, because UC mode's stealth degrades in headless. The fallback
runs from Probe, Selector Lab, manual scrapes, and the daily scheduled
scrape — no per-site configuration is needed. If the system has no
installed Chrome or the stealth retry also gets blocked, the scrape
returns the existing `needs_review` result instead of crashing.

Bot-challenge sites pay roughly 30 seconds on every scrape waiting for
the headless Chromium to give up before the stealth retry kicks in.
Avoid moving the mouse during the auto-click window or pyautogui can
miss the checkbox.

## Probe And Selector Lab

Use Probe when a page is extracting the wrong title, price, sale price, dealer
price, stock status, or image.

Use Selector Lab when you need to repair a site profile:

1. Paste a product URL.
2. Scan the page.
3. Review candidates.
4. Assign fields such as `title`, `price`, `discounted_price`, `dealer_price`,
   `stock_status`, `image`, or `wait_for`.
5. Test the profile.
6. Save it for the domain.

Saved profiles live in [backend/scraper/sites.toml](./backend/scraper/sites.toml)
in source builds. Installed builds copy that file into the user data directory
so local profile edits survive upgrades.

Example:

```toml
["example.com"]
platform = "generic"
wait_for = ".product-price"
selectors = { title = "h1", price = ".regular-price", discounted_price = ".sale-price", stock_status = ".availability" }
```

## Import Workflow

Gabada supports three import families.

### WooCommerce

- Preview catalog products before importing.
- Fetch beyond the first WooCommerce page.
- Select only the products to import.
- Save Woo credentials on a store.
- Optionally auto-add newly discovered Woo products during future syncs.

### Store APIs

Gabada ships with built-in support for game-storefront APIs and a Custom
JSON template for any other JSON catalog feed:

| Provider | Auth | Notes |
| --- | --- | --- |
| Steam | none | Public storefront API |
| Apple App Store | none | iTunes lookup API |
| GOG | none | Public catalog API |
| Custom JSON | configurable | Template engine for PlayStation, Xbox, Epic, EA Play, Ubisoft, Nintendo, Apple Store, Google Play, and any other JSON feed |

API-enabled product_stores skip Playwright entirely on the daily
scheduled scrape and pull prices via HTTP, which is faster, more
reliable, and avoids triggering bot protection. Per-store API config
is exposed in the Stores page (`api_enabled`, `api_platform`,
`api_base_url`, `api_key`, `api_config`, `api_auto_import_new`).

### Documents

Supported upload formats:

- CSV
- XLSX
- XLS
- PDF

Document import can map product name, URL, image URL, retail price, sale price,
dealer price, warranty, and stock fields. Rows without a live product URL can be
kept as inactive store links for price-list style tracking.

## Backup And Drive Sync

Manual backup:

- `Settings -> Backup, restore, and share` exports a backup archive.
- The archive contains the SQLite database, scraper profiles, and metadata.
- Import replaces the local library and creates a safety copy first.
- Plain `.db`, `.sqlite`, and `.sqlite3` files can also be imported.

Google Drive sync:

- Uses a manual push/restore snapshot workflow.
- Stores snapshots in a `Gabada` folder in the signed-in Google Drive account.
- Keeps the latest snapshots and prunes older ones.
- Uses the `drive.file` scope so Gabada can access files it created.
- Does not do live two-way sync or conflict resolution.

Recommended multi-device workflow:

1. Restore the newest snapshot before editing on a device.
2. Make changes.
3. Push a new snapshot when done.
4. Restore that snapshot on the next device before editing there.

## Local API Security

Gabada is a local desktop-style app, not a hosted multi-user service. Defenses
applied to every `/api/*` request:

- **Origin allowlist.** Browser requests are only accepted from trusted local
  app origins:
  - `http://127.0.0.1:8000` through `http://127.0.0.1:8010`
  - `http://localhost:8000` through `http://localhost:8010`
  - `http://localhost:5173` and `http://127.0.0.1:5173` for Vite development

  Use `GABADA_ALLOWED_ORIGINS` to add comma-separated extra origins for a
  custom local setup.

- **Host header validation.** Requests whose `Host` header does not point at a
  loopback interface on an allowed port are rejected, even if `Origin` and
  `Sec-Fetch-Site` are absent. This blocks DNS-rebinding attacks where a
  hostile page bound to `evil.example` later resolves to `127.0.0.1`.

- **`Sec-Fetch-Site` allowlist.** Only `same-origin`, `same-site`, and `none`
  are accepted; any cross-site fetch is rejected.

- **Security headers on every response.** `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` lockdown
  for camera / microphone / geolocation. The local UI cannot be embedded in a
  hostile iframe.

- **Path confinement on session files.** The Playwright `storage_state` paths
  used by `/api/scraper/login-session` and `/api/scraper/probe` are confined to
  the Gabada sessions directory (and `backend/` in source checkouts). Absolute
  paths and `..` traversal that escape the allowed base are rejected with a
  400 — no arbitrary file reads or writes.

- **URL scheme allowlist for scraper inputs.** `/api/scraper/probe`,
  `/selector-lab`, `/selector-lab/test`, and `/login-session` only accept
  `http://` and `https://` URLs. `file://`, `javascript:`, and `data:` URLs
  are rejected before they reach Playwright.

## Runtime Data

Development builds store data in `backend/` by default.

Installed or frozen builds store writable data under the platform app-data
folder:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\Gabada` |
| macOS | `~/Library/Application Support/Gabada` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/Gabada` |

Data includes:

- `gabada.db`
- `sites.toml`
- `sessions/`
- `logs/`
- `backups/`
- Drive credentials/tokens when Drive sync is configured

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `GABADA_DATA_DIR` | Override the user data directory. Useful for testing or running separate libraries. |
| `GABADA_NO_BROWSER` | Set to `1`, `true`, or `yes` to stop the launcher from opening a browser. |
| `GABADA_ALLOWED_ORIGINS` | Comma-separated extra browser origins allowed to call the local API. |
| `PLAYWRIGHT_BROWSERS_PATH` | Set automatically in bundled builds when Playwright browsers are packaged with the app. |

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

Core stack:

| Layer | Technology |
| --- | --- |
| Backend | FastAPI, Uvicorn, Playwright, SeleniumBase (optional, stealth fallback), APScheduler, aiosqlite, Pydantic v2 |
| Frontend | React 19, Vite 8, TypeScript, Tailwind v4, TanStack Query, Zustand, Recharts |
| Database | SQLite in WAL mode |
| Packaging | PyInstaller and Inno Setup |

## API

The API is mounted under `/api`. Interactive docs are available at `/docs` when
the backend is running.

Common endpoints:

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
| `POST` | `/api/import/api/preview` | Preview API catalog products before import |
| `POST` | `/api/import/api/import` | Import selected API catalog products |
| `GET` | `/api/settings/database/export` | Download backup archive |
| `POST` | `/api/settings/database/import` | Restore backup archive or database |
| `POST` | `/api/drive/snapshots/push` | Upload Drive snapshot |
| `POST` | `/api/drive/snapshots/restore/{id}` | Restore Drive snapshot |

## Packaging And Releases

Build Windows installer and portable bundle:

```powershell
cd packaging\windows
.\build_installer.ps1
```

Build Linux/macOS portable bundle:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
./packaging/build_release.sh --app-version 0.7.3
```

Pushing a `v*` tag or publishing a GitHub Release triggers
[.github/workflows/release.yml](./.github/workflows/release.yml). The workflow
builds Windows, Linux, and macOS artifacts and uploads them to the release.

Expected artifact names:

| Platform | Artifact |
| --- | --- |
| Windows | `GabadaSetup-<tag>-windows-x64.exe` |
| Windows | `Gabada-<tag>-windows-x64.zip` |
| Linux | `Gabada-<tag>-linux-x64.tar.gz` |
| macOS | `Gabada-<tag>-macos-arm64.tar.gz` |

Each release job also writes an update manifest:

```text
gabada-update-<tag>-<platform>-<arch>.json
```

The Settings page uses GitHub Releases to compare the running app version with
the newest release and recommend the matching installer or portable bundle.

## Troubleshooting

### Uvicorn command fails

Use the backend virtualenv Python from inside `backend`:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

If `.venv` is missing, create it and install dependencies first.

### Probe or Selector Lab detects the wrong price

- Check whether the value is a sale price, regular price, dealer price, or unrelated page text.
- Use Probe to inspect candidates and review notes.
- Use Selector Lab to pin stronger selectors.
- Save the profile for the domain.
- Rescrape the affected product/store link.

### A page shows a strikethrough price

Map the strikethrough/original price to `price` and the current sale price to
`discounted_price`. The UI uses the discounted value as the effective current
price when it exists.

### Drive sign-in hangs or fails

- Cancel the sign-in attempt in Settings.
- Verify the Google Cloud OAuth client is a Desktop client.
- Confirm the Drive API is enabled.
- Start sign-in again and complete the new browser tab.

### A scrape opens a Chrome window and the cursor moves on its own

That is the SeleniumBase stealth fallback clicking through a Cloudflare /
Turnstile bot challenge — `tab.solve_captcha()` on SeleniumBase 4.50+,
or pyautogui on older releases. It runs only when the headless
Chromium scrape fails. Don't move the mouse during the click window or
the Turnstile checkbox can be missed. If the challenge is consistently
not bypassed, install or update the seleniumbase dependency (Gabada
targets 4.50.5 or newer):

```powershell
.\backend\.venv\Scripts\python.exe -m pip install --upgrade seleniumbase
```

The app boots without seleniumbase — bot-challenge sites simply return
the existing `needs_review` result instead of being bypassed.

### The app opens but the frontend is missing

Run:

```powershell
cd frontend-web
npm.cmd run build
```

Then restart the backend or launcher.

## License

Gabada is released under the [MIT License](./LICENSE).

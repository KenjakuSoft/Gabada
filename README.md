# Gabada

Local-first price and stock tracking for products across online stores.

Gabada runs a FastAPI backend, a React web UI, Playwright-powered scraping, and a
SQLite database on your own machine. It is built for comparing store prices,
keeping historical price logs, importing catalogs, and repairing scraper results
when a site layout changes.

[Changelog](./CHANGELOG.md) | [License](./LICENSE)

## Current Release

Latest stable release: `v0.5.0`

Recent highlights:

- Added in-app update checks with release asset recommendations.
- Added update manifests to future GitHub Release artifacts.
- Cleaned up Probe and Selector Lab price displays so discounts only appear when a distinct sale price exists.
- Tightened local API browser origin checks and made manual scrape actions wait for real completion before refreshing the UI.
- Fixed the Nexxcom-style `Rs 4` false price regression in Probe and Selector Lab.

See [CHANGELOG.md](./CHANGELOG.md) for full release notes.

## Features

- Track one product across many stores.
- Save price, discounted price, dealer price, stock status, warranty text, and scrape history.
- Compare current store prices from the Home and Product Detail pages.
- Organize products by category.
- Import products from WooCommerce, CSV, XLSX, XLS, and PDF.
- Preview imports, map columns, target existing products, and commit selected rows.
- Sync WooCommerce catalogs before scheduled scrapes and optionally auto-add new catalog products.
- Use Probe to inspect what the scraper sees before saving a profile.
- Use Selector Lab to assign selectors, test them, and save reusable domain profiles.
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

Playwright downloads its own Chromium browser during setup.

## Quick Start

### Clone

```powershell
git clone https://github.com/Xx-LiDAF-xX/Gabada.git
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
4. Deterministic smart page scan with installment and payment-method filters.
5. Common selectors and saved per-domain profiles.

Structured-data hits are treated as strong signals. The review step can surface
an alternative candidate when smart scan disagrees, but extreme mismatches are
guarded so small stray text fragments do not replace real product prices.

Manual scrape endpoints wait until the scrape finishes and then return the real
status. The UI refreshes product data after completion instead of immediately
after queueing.

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

Gabada supports two import families.

### WooCommerce

- Preview catalog products before importing.
- Fetch beyond the first WooCommerce page.
- Select only the products to import.
- Save Woo credentials on a store.
- Optionally auto-add newly discovered Woo products during future syncs.

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

Gabada is a local desktop-style app, not a hosted multi-user service. The backend
binds to localhost for launcher use and only allows browser API requests from
trusted local app origins:

- `http://127.0.0.1:8000` through `http://127.0.0.1:8010`
- `http://localhost:8000` through `http://localhost:8010`
- `http://localhost:5173` and `http://127.0.0.1:5173` for Vite development

Use `GABADA_ALLOWED_ORIGINS` to add comma-separated extra origins for a custom
local setup.

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
    scraper/             Playwright scraper engine and sites.toml profiles
    services/            Backup bundle and Google Drive sync helpers
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
| Backend | FastAPI, Uvicorn, Playwright, APScheduler, aiosqlite, Pydantic v2 |
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
./packaging/build_release.sh --app-version 0.5.0
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

### The app opens but the frontend is missing

Run:

```powershell
cd frontend-web
npm.cmd run build
```

Then restart the backend or launcher.

## License

Gabada is released under the [MIT License](./LICENSE).

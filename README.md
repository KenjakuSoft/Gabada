# Gabada

> Track prices, compare stores, and repair scraping issues from one local app.

<div align="center">

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

[Quick Start](#quick-start) | [Features](#features) | [Import Workflow](#import-workflow) | [Selector Lab](#selector-lab) | [Development](#development) | [Releases](#releases)

</div>

Gabada is a local-first product price and stock tracker for online stores. It scrapes product pages, stores history in SQLite, and gives you a web app for managing products, comparing stores, reviewing activity, and correcting scraper problems when a site layout changes.

## Highlights

- Track the same product across multiple stores
- Log regular, sale, and dealer pricing over time
- Review stock changes in a live activity feed
- Import from WooCommerce, CSV, Excel, and PDF
- Preview document rows before importing anything
- Use Probe and Selector Lab to diagnose and fix scraper issues
- Save selector profiles per domain for more reliable future syncs
- Run locally with a simple launcher or Windows release build

## Features

| Area | What it does |
| --- | --- |
| Multi-store tracking | Link one product to many stores and compare the latest prices side by side. |
| Price history | Save each scrape and surface meaningful price and stock changes in Activity. |
| Selector Lab | Inspect selectors, assign fields, test extraction, and save reusable domain profiles. |
| Probe | Preview what the scraper sees before you commit a product or profile change. |
| Import tools | Bring in large catalogs from WooCommerce or product documents with live preview. |
| Safer extraction | Cross-check suspicious price or stock matches against stronger page signals before saving them. |
| Categories | Organize products with category names and colors. |
| Windows launcher | Start the app with [start_gabada.bat](./start_gabada.bat) after setup. |

## App Areas

- `Home` for product overview and quick actions
- `Categories` for category management
- `Add product` for quick-add URL flows
- `Stores` for store management
- `Import` for WooCommerce and document import
- `Probe` for scrape diagnostics
- `Selector Lab` for selector discovery, testing, and profile saving
- `Activity` for recent price and stock changes
- `Settings` for app settings and site profile editing

## Import Workflow

Gabada now supports full-catalog style imports for both WooCommerce and document-based sources.

### WooCommerce import

- preview the store catalog before importing
- fetch more than the first page instead of stopping at 100
- select only the products you want to bring in

### Document import

- upload `CSV`, `XLSX`, `XLS`, or `PDF`
- parse the full table instead of only a tiny sample
- map columns for:
  - product name
  - product URL
  - image URL
  - retail price
  - sale price
  - dealer price
  - stock
- choose the destination store and optional category
- select exactly which rows should be imported
- update an existing product/store match when the document row belongs to the same store

Rows without a real product URL can still be imported as inactive store links for price-list style tracking until a live product page is attached later.

## Selector Lab

Selector Lab is the recovery tool for hard-to-scrape stores.

Use it when:

- a page includes unrelated numbers near the product area
- payment or installment amounts are confusing the scraper
- stock labels are mixed with unrelated buttons or cards
- a store layout changed
- you want to save a better selector profile for future syncs

Typical flow:

1. Open `/selector-lab`
2. Paste a product URL
3. Scan the page
4. Review selector candidates
5. Assign fields such as `wait_for`, `title`, `price`, `discounted_price`, `dealer_price`, `stock_status`, or `image`
6. Test the profile
7. Save it for the domain

If Gabada auto-corrects a suspicious scrape, Probe and Selector Lab surface a review warning so you can confirm what changed.

## Quick Start

### Requirements

- Python 3.11+
- Node.js 20+
- Git

Playwright downloads its own Chromium build, so you do not need a separate browser install.

### Clone

```powershell
git clone https://github.com/Xx-LiDAF-xX/Gabada.git
cd Gabada
```

### Backend setup

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

### Frontend setup

```powershell
cd ..\frontend-web
npm.cmd install
npm.cmd run build
```

### Run the app

#### Windows launcher

Double-click [start_gabada.bat](./start_gabada.bat).

It will:

- use `backend\.venv\Scripts\python.exe`
- run the desktop launcher at `backend\desktop_launcher.py`
- reuse an existing backend process when one is already active
- open the app in your browser after `/health` is ready

#### Manual start

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

#### Desktop-style local launcher

```powershell
cd backend
.\.venv\Scripts\python.exe desktop_launcher.py
```

Open:

- App: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

## Development

Run backend and frontend separately for hot reload.

### Terminal 1

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

### Terminal 2

```powershell
cd frontend-web
npm.cmd run dev
```

Open:

- Frontend dev server: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- Backend API: [http://127.0.0.1:8000](http://127.0.0.1:8000)

The frontend proxies API calls to `/api` on the backend.

### Useful commands

#### Frontend

```powershell
cd frontend-web
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
```

#### Backend

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
.\.venv\Scripts\python.exe -m py_compile main.py
```

## Architecture

```text
Gabada/
|- backend/
|  |- api/
|  |- database/
|  |- scheduler/
|  |- scraper/
|  |- main.py
|  `- requirements.txt
|- frontend-web/
|  |- src/
|  `- package.json
|- packaging/
|- start_gabada.bat
`- README.md
```

Stack:

- Backend: FastAPI, Playwright, APScheduler, aiosqlite, Pydantic
- Frontend: React 19, Vite 8, TypeScript, Tailwind v4, TanStack Query
- Database: SQLite at `backend/gabada.db`

## Scraping Model

Gabada uses a layered extraction approach:

1. JSON-LD structured data
2. Microdata and schema hints
3. Smart page scan
4. Common patterns and saved selectors

Important behavior:

- prices and stock are scraped outside the API request cycle
- one Playwright browser instance is reused
- per-domain selector overrides can be saved
- `price` is treated as the regular or original price
- `discounted_price` is treated as the current sale price
- suspicious results can be reviewed and auto-corrected before saving

## Site Profiles

Gabada stores domain-level scrape profiles in [backend/scraper/sites.toml](./backend/scraper/sites.toml).

You can edit profiles in two ways:

- in the app under `Settings -> Site profiles`
- directly in `backend/scraper/sites.toml`

Example:

```toml
["example.com"]
platform = "generic"
wait_for = ".product-price"
selectors = { title = "h1", price = ".product-price", stock_status = ".availability" }
```

## API

The backend API is mounted under `/api`.

Common endpoints:

- `GET /health`
- `GET /api/products/`
- `GET /api/stores/`
- `GET /api/categories/`
- `POST /api/import/woo/preview`
- `POST /api/import/woo/import`
- `POST /api/import/file/preview`
- `POST /api/import/file/commit`
- `POST /api/scraper/probe`
- `POST /api/scraper/selector-lab`
- `POST /api/scraper/selector-lab/test`
- `PUT /api/scraper/selector-lab/profile`
- `POST /api/scraper/scrape/{product_store_id}`
- `POST /api/scraper/scrape-all`

Interactive docs are available at `/docs`.

## Releases

### Latest stable release

- `v0.1.1` is the current published Windows release line.

### Windows installer builds

Packaging files live in [packaging/windows](./packaging/windows):

- `gabada.spec` for the PyInstaller bundle
- `build_installer.ps1` for local packaging
- `gabada.iss` for the Inno Setup installer

Build locally with:

```powershell
cd packaging\windows
.\build_installer.ps1
```

The script will:

- build the frontend bundle
- install packaging requirements
- download the Playwright Chromium bundle for packaging
- create a desktop app bundle with PyInstaller
- create an installer when Inno Setup 6 is installed

### GitHub Releases

Publishing a GitHub Release triggers the workflow at [.github/workflows/windows-release.yml](./.github/workflows/windows-release.yml).

Release assets:

- `GabadaSetup-<tag>-windows-x64.exe`
- `Gabada-<tag>-windows-x64.zip`

You can also run the workflow manually for an existing tag from GitHub Actions.

Installed app behavior:

- runs as a normal desktop app and opens the browser automatically
- stores user data in a writable app-data folder instead of the install folder
- bundles the frontend and default scraper profiles with the app

Typical runtime data locations:

- Windows: `%APPDATA%\Gabada`
- macOS: `~/Library/Application Support/Gabada`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/Gabada`

## Troubleshooting

### The app opens but the UI is missing

Build the frontend first:

```powershell
cd frontend-web
npm.cmd run build
```

### `start_gabada.bat` says the venv is missing

Create the backend virtual environment and install dependencies:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### A store scrapes the wrong price or stock

- try `Probe` first to inspect the extracted result
- use `Selector Lab` to test stronger selectors
- save a selector profile for the domain
- rescrape the affected products after the fix

### A document import looks incomplete

- confirm the correct sheet or table is present in the preview
- remap columns before committing
- for PDF price lists, make sure the product data appears in a table or column layout

### API requests fail in development

Make sure both servers are running:

- backend on `8000`
- Vite on `5173`

## License

[MIT](./LICENSE)

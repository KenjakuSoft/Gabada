<div align="center">

# Gabada

### Track prices, compare stores, and fix scraper issues without leaving the app.

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

[Quick Start](#quick-start) | [Features](#feature-highlights) | [Selector Lab](#selector-lab) | [Development](#development) | [API](#api)

</div>

Gabada is a local product price and stock tracker for online stores. It scrapes product pages, stores history in SQLite, and gives you a web app for managing products, comparing stores, spotting price drops, and fixing scraper problems when a site layout changes.

## Why Gabada

- Track the same product across multiple stores
- Log price and stock changes over time
- Import products from WooCommerce, CSV, Excel, or PDF
- Diagnose scraper issues with `Probe`
- Repair hard sites with `Selector Lab`
- Save selector profiles per store or domain

## Feature Highlights

| | |
|---|---|
| **Multi-store tracking** | Link one product to multiple shops and compare latest prices side by side. |
| **Price history** | Store every scrape and surface meaningful price and stock changes in the activity feed. |
| **Selector Lab** | Scan a page, review candidate selectors, test them, and save a profile for the store. |
| **Probe tools** | Inspect the scraper output for a product URL before you save or rescrape anything. |
| **Safer extraction** | Cross-check suspicious price and stock matches against the main product area before accepting them. |
| **Bulk import** | Bring in products from WooCommerce, CSV, Excel, or PDF. |
| **Category management** | Organize products with category names and colors. |
| **Launcher included** | Start the app with [start_gabada.bat](./start_gabada.bat) on Windows after setup. |
| **Built for noisy stores** | Helpful for sites with installment prices, related-product numbers, or inconsistent markup. |

## Product Workflow

1. Add or import products.
2. Link each product to one or more store URLs.
3. Scrape automatically or trigger manual scrapes.
4. Review price history and recent activity.
5. If a store breaks, use `Probe` or `Selector Lab` to correct it.

## App Areas

- `Home` - overview of tracked products
- `Categories` - manage category names and colors
- `Add product` - quick add using product URLs
- `Stores` - manage store records
- `Import` - WooCommerce and file import
- `Probe` - inspect what the scraper extracted from a URL
- `Selector Lab` - inspect selector candidates, assign fields, test, and save
- `Activity` - recent price and stock changes
- `Settings` - app settings and site-profile editor

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

### Run The App

**Windows launcher**

Double-click [start_gabada.bat](./start_gabada.bat).

What it does:
- uses `backend\.venv\Scripts\python.exe`
- runs the desktop launcher at `backend\desktop_launcher.py`
- reuses an already running Gabada window if one is active
- opens the app in your browser after the backend is ready

**Manual start**

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

**Desktop-style local launcher**

```powershell
cd backend
.\.venv\Scripts\python.exe desktop_launcher.py
```

Open:
- App: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

## Installer Builds

Gabada now has a Windows packaging setup for a real desktop-style install flow.

Packaging files live in [packaging/windows](./packaging/windows):
- `gabada.spec` - PyInstaller app bundle definition
- `build_installer.ps1` - build script for the app bundle and installer
- `gabada.iss` - Inno Setup installer definition

Build a Windows installer with:

```powershell
cd packaging\windows
.\build_installer.ps1
```

What the script does:
- builds the frontend bundle
- installs packaging requirements
- downloads a local Playwright Chromium bundle for packaging
- creates a desktop app bundle with PyInstaller
- creates `GabadaSetup.exe` if Inno Setup 6 is installed

GitHub Releases can also attach the Windows installer and a portable ZIP automatically through the workflow at [.github/workflows/windows-release.yml](./.github/workflows/windows-release.yml).

### GitHub Releases

Publishing a GitHub Release triggers the Windows packaging workflow automatically.

Release assets:
- `GabadaSetup-<tag>-windows-x64.exe`
- `Gabada-<tag>-windows-x64.zip`

You can also run the workflow manually from GitHub Actions and provide an existing tag.

Installed app behavior:
- runs as a normal desktop app and opens the browser automatically
- keeps user data in a writable app-data folder instead of the install folder
- bundles the frontend and default scraper profiles with the app

Typical runtime data locations:
- Windows: `%APPDATA%\Gabada`
- macOS: `~/Library/Application Support/Gabada`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/Gabada`

## Selector Lab

Selector Lab is the main recovery tool for stores that scrape badly.

Use it when:
- a page has multiple unrelated numbers
- installment or payment-plan amounts confuse the scraper
- stock buttons or availability labels are mixed with unrelated product cards
- a site layout changed
- you want to save a more reliable selector profile for a domain

Typical workflow:

1. Open `/selector-lab`
2. Paste a product URL
3. Scan selectors
4. Review recommended candidates
5. Assign `wait_for`, `title`, `price`, `discounted_price`, `stock_status`, or `image`
6. Test the selection
7. Save it for the store or domain

For noisy pages, turn on the helpful filtering and ignore payment or related-product rows.
If the scraper auto-corrects a suspicious match, Probe and Selector Lab surface a review warning so you can verify what changed.

## Scraping Model

Gabada uses a waterfall approach:

1. JSON-LD structured data
2. Microdata and schema hints
3. Smart page scan
4. Common patterns and custom selectors

Important behavior:
- prices and stock are scraped outside the API request cycle
- the backend reuses one Playwright browser instance
- per-site selector overrides can be saved by hostname
- `price` is treated as the regular or original price
- `discounted_price` is treated as the current sale price
- price and stock selection prefer the main product area over related, payment, or header/footer noise
- suspicious matches can be reviewed and auto-corrected before they are saved

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

### Useful Commands

**Frontend**

```powershell
cd frontend-web
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
```

**Backend**

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
|- start_gabada.bat
`- README.md
```

Stack:
- Backend: FastAPI, Playwright, APScheduler, aiosqlite, Pydantic
- Frontend: React 19, Vite 8, TypeScript, Tailwind v4, TanStack Query
- Database: SQLite at `backend/gabada.db`

## API

The backend API is mounted under `/api`.

Common endpoints:
- `GET /health`
- `GET /api/products/`
- `GET /api/stores/`
- `GET /api/categories/`
- `POST /api/scraper/probe`
- `POST /api/scraper/selector-lab`
- `POST /api/scraper/selector-lab/test`
- `PUT /api/scraper/selector-lab/profile`
- `POST /api/scraper/scrape/{product_store_id}`
- `POST /api/scraper/scrape-all`

Interactive docs are available at `/docs`.

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

### A store scrapes the wrong price

- try `Probe` first to see what the scraper extracted
- use `Selector Lab` for that product page
- save a selector profile for the store or domain
- rescrape the affected products after fixing selectors

### API requests fail in development

Make sure both servers are running:
- backend on `8000`
- Vite on `5173`

## License

[MIT](./LICENSE)

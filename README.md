# Gabada

Gabada is a local product price and stock tracker for online stores. It scrapes product pages, stores price history in SQLite, and gives you a web UI for comparing stores, spotting price drops, and fixing scraper issues when a shop changes its layout.

## What it does

- Track one product across multiple stores
- Log price and stock changes over time
- Import products from WooCommerce, CSV, Excel, or PDF
- Use `Probe` to inspect what the scraper extracted
- Use `Selector Lab` to scan a page, review selector candidates, test them, and save a profile for a store/domain
- Save per-site scrape profiles in `backend/scraper/sites.toml`

## Stack

- Backend: FastAPI, Playwright, APScheduler, aiosqlite, Pydantic
- Frontend: React 19, Vite 8, TypeScript, Tailwind v4, TanStack Query
- Database: SQLite at [gabada.db](/C:/Users/NEXXCOM/Desktop/Gabada/backend/gabada.db)

## Project layout

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

## Requirements

- Python 3.11+
- Node.js 20+
- Git

Playwright downloads its own Chromium build, so you do not need to install a browser separately.

## Clone

```powershell
git clone https://github.com/Xx-LiDAF-xX/Gabada.git
cd Gabada
```

## First-time setup

### Backend

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

### Frontend

```powershell
cd ..\frontend-web
npm.cmd install
npm.cmd run build
```

## Run the app

### Windows launcher

After setup, double-click [start_gabada.bat](/C:/Users/NEXXCOM/Desktop/Gabada/start_gabada.bat).

Notes:
- It uses `backend\.venv\Scripts\python.exe`
- It checks `http://127.0.0.1:8000/health` before opening the app
- It expects the frontend to already be built

### Manual run

```powershell
cd C:\Users\NEXXCOM\Desktop\Gabada\backend
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

Open:
- App: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

## Development mode

Run the backend and frontend separately for hot reload.

### Terminal 1

```powershell
cd C:\Users\NEXXCOM\Desktop\Gabada\backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

### Terminal 2

```powershell
cd C:\Users\NEXXCOM\Desktop\Gabada\frontend-web
npm.cmd run dev
```

Open:
- Frontend dev server: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- Backend API: [http://127.0.0.1:8000](http://127.0.0.1:8000)

The frontend proxies API calls to `/api` on the backend.

## Main app areas

- Home: overview of tracked products
- Categories: manage category names and colors
- Add product: quick add via URLs
- Stores: manage store records
- Import: WooCommerce and file import
- Probe: inspect what the scraper extracted from a URL
- Selector Lab: inspect page candidates, assign selectors, test them, and save them
- Activity: recent price and stock changes
- Settings: app settings and site-profile editor

## Scraping model

The scraper uses a waterfall approach:

1. JSON-LD structured data
2. Microdata / schema hints
3. Smart page scan
4. Common patterns and custom selectors

Important behavior:
- Prices and stock are scraped outside the API request cycle
- The backend reuses one Playwright browser instance
- Site-specific selector overrides can be saved by hostname
- `price` is treated as the regular/original price
- `discounted_price` is treated as the current sale price

## Selector Lab

Selector Lab is the main tool for hard-to-scrape stores.

Use it when:
- a store has multiple unrelated numbers on the page
- installment/payment-plan prices are confusing the scraper
- a product page layout changed
- you want to save a better selector profile for a domain

Typical workflow:

1. Open `/selector-lab`
2. Paste a product URL
3. Scan selectors
4. Review recommended candidates
5. Assign `wait_for`, `title`, `price`, `discounted_price`, `stock_status`, or `image`
6. Test the selection
7. Save it for the store/domain

For sites with noisy pages, use the "Useful only" filter and ignore payment or related-product rows.

## Site profiles

Gabada stores domain-level scrape profiles in [sites.toml](/C:/Users/NEXXCOM/Desktop/Gabada/backend/scraper/sites.toml).

You can edit them in two ways:
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
- `POST /api/scraper/probe`
- `POST /api/scraper/selector-lab`
- `POST /api/scraper/selector-lab/test`
- `PUT /api/scraper/selector-lab/profile`
- `POST /api/scraper/scrape/{product_store_id}`
- `POST /api/scraper/scrape-all`

Interactive docs are available at `/docs`.

## Useful commands

### Frontend

```powershell
cd frontend-web
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
```

### Backend

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
.\.venv\Scripts\python.exe -m py_compile main.py
```

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

- Try `Probe` first to see what the scraper is extracting
- Use `Selector Lab` for that product page
- Save a selector profile for the store/domain
- Re-scrape the affected products after fixing the selectors

### API requests fail in development

Make sure both servers are running:
- backend on `8000`
- Vite on `5173`

## License

[MIT](/C:/Users/NEXXCOM/Desktop/Gabada/LICENSE)

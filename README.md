<div align="center">

# 🛒 Gabada

### Track prices, compare stores, and repair scraping issues — all from one local app.

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

**[⚡ Quick Start](#-quick-start)** · **[✨ Features](#-features)** · **[📥 Import](#-import-workflow)** · **[🔬 Selector Lab](#-selector-lab)** · **[🛠 Development](#-development)** · **[📦 Releases](#-releases)**

</div>

---

> Gabada is a local-first product price and stock tracker for online stores. It scrapes product pages, stores history in SQLite, and gives you a web app for managing products, comparing stores, reviewing activity, and correcting scraper problems when a site layout changes.

---

## ✨ Highlights

- 🏬 **Multi-store tracking** — link one product to many stores
- 📈 **Full price history** — regular, sale, and dealer pricing over time
- 📜 **Document fields** — store warranty alongside price snapshots
- 🔔 **Live activity feed** — surface meaningful price and stock changes
- 📥 **Multi-source import** — WooCommerce, CSV, Excel, and PDF
- 🎯 **Row-level matching** — attach document rows to existing products before importing
- 💾 **Portable backups** — export and import a shareable archive
- 🔄 **Scheduled Woo sync** — auto-add new catalog products
- 🔬 **Probe + Selector Lab** — diagnose and fix scraper issues
- 🧬 **Per-domain profiles** — save reusable selectors for reliable future syncs
- 🖥 **One-click launcher** — Windows release build or local launcher

## 🧭 Features

| Area | What it does |
| :--- | :--- |
| 🏬 **Multi-store tracking** | Link one product to many stores and compare the latest prices side by side. |
| 📈 **Price history** | Save each scrape and surface meaningful price and stock changes in Activity. |
| 🔬 **Selector Lab** | Inspect selectors, assign fields, test extraction, and save reusable domain profiles. |
| 🔍 **Probe** | Preview what the scraper sees before you commit a product or profile change. |
| 📥 **Import tools** | Bring in large catalogs from WooCommerce or product documents with full preview, row targeting, selective updates, and optional scheduled Woo sync. |
| 💾 **Backup & restore** | Export a shareable backup archive and import it into another Gabada install with a safety copy first. |
| 🛡 **Safer extraction** | Cross-check suspicious price or stock matches against stronger page signals before saving them. |
| 🏷 **Categories** | Organize products with category names and colors. |
| 🚀 **Windows launcher** | Start the app with [`start_gabada.bat`](./start_gabada.bat) after setup. |

## 🗺 App Areas

| Page | Purpose |
| :--- | :--- |
| 🏠 **Home** | Product overview and quick actions |
| 🏷 **Categories** | Category management |
| ➕ **Add product** | Quick-add URL flows |
| 🏬 **Stores** | Store management |
| 📥 **Import** | WooCommerce and document import |
| 🔍 **Probe** | Scrape diagnostics |
| 🔬 **Selector Lab** | Selector discovery, testing, and profile saving |
| 🔔 **Activity** | Recent price and stock changes |
| ⚙ **Settings** | App settings, backups, and site profile editing |

## 📥 Import Workflow

Gabada supports full-catalog style imports for both WooCommerce and document-based sources.

### 🛍 WooCommerce import

- 👀 Preview the store catalog before importing
- 📚 Fetch more than the first page instead of stopping at 100
- 🔁 Handle broken or repeating Woo pagination more safely
- ✅ Select only the products you want to bring in
- 🔐 Optionally save Woo credentials on the destination store
- 🤖 Optionally auto-add new Woo products during future scheduled syncs

### 📄 Document import

Upload `CSV`, `XLSX`, `XLS`, or `PDF` and parse the full document — not just a tiny sample.

<details>
<summary><b>Column mapping</b> — click to expand</summary>

| Field | Description |
| :--- | :--- |
| Product name | Display name shown across the app |
| Product URL | Canonical store page (optional — see below) |
| Image URL | Product image |
| Retail price | Original / regular price |
| Sale price | Current discounted price |
| Dealer price | Wholesale or trade price |
| Warranty | Document-only metadata kept alongside snapshots |
| Stock | Stock status text |

</details>

- 🔎 Search across the parsed document before committing anything
- 🎯 Choose the destination store and optional category
- ✅ Select exactly which rows should be imported
- 🔗 Attach each row to an existing Gabada product when needed
- ✏️ Update the exact product/store link when the selected store already exists on that product
- ➕ Create a new store link on an existing product if the store is not linked yet

> 💡 Rows without a real product URL can still be imported as inactive store links for price-list style tracking until a live product page is attached later. Availability text such as `call for price`, `contact us`, or `discontinued` is preserved instead of collapsing into plain `unknown`.

When Woo sync is enabled on a store, Gabada checks that catalog before scheduled scrapes and can add newly discovered products automatically.

## 🔬 Selector Lab

Selector Lab is the recovery tool for hard-to-scrape stores.

**Use it when:**

- 🔢 A page includes unrelated numbers near the product area
- 💳 Payment or installment amounts are confusing the scraper
- 📦 Stock labels are mixed with unrelated buttons or cards
- 🏗 A store layout changed
- 💾 You want to save a better selector profile for future syncs

**Typical flow:**

1. Open `/selector-lab`
2. Paste a product URL
3. Scan the page
4. Review selector candidates
5. Assign fields such as `wait_for`, `title`, `price`, `discounted_price`, `dealer_price`, `stock_status`, or `image`
6. Test the profile
7. Save it for the domain

> ⚠️ If Gabada auto-corrects a suspicious scrape, Probe and Selector Lab surface a review warning so you can confirm what changed.

## 💾 Backup & Restore

Gabada can move a filled setup between installs without starting over.

- 📤 `Settings → Backup, restore, and share` exports a shareable backup archive
- 📦 The archive includes the SQLite database and saved scraper profiles
- 📥 Importing a backup replaces the current local library on that machine
- 🛟 Before import, Gabada creates a safety copy of the current database
- 🗄 Plain `.db` / `.sqlite` files can also be imported when that's all you have

> 🪄 Installed desktop builds keep user data in the app-data folder, so upgrading to a newer release continues using the same library automatically.

## ⚡ Quick Start

### 📋 Requirements

| Tool | Version |
| :--- | :--- |
| 🐍 Python | 3.11+ |
| 🟢 Node.js | 20+ |
| 🔧 Git | any recent |

> Playwright downloads its own Chromium build, so you do not need a separate browser install.

### 1️⃣ Clone

```powershell
git clone https://github.com/Xx-LiDAF-xX/Gabada.git
cd Gabada
```

### 2️⃣ Backend setup

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

> `py -3` selects the latest installed Python 3 launcher. Pin a specific version with `py -3.11` (or newer) if you have several installed.

### 3️⃣ Frontend setup

```powershell
cd ..\frontend-web
npm.cmd install
npm.cmd run build
```

### 4️⃣ Run the app

#### 🖱 Windows launcher

Double-click [`start_gabada.bat`](./start_gabada.bat). It will:

- 🐍 use `backend\.venv\Scripts\python.exe`
- 🚀 run the desktop launcher at `backend\desktop_launcher.py`
- ♻️ reuse an existing backend process when one is already active
- 🌐 open the app in your browser after `/health` is ready

| Variant | Behavior |
| :--- | :--- |
| [`Start Gabada.vbs`](./Start%20Gabada.vbs) | Launch silently — runs `start_gabada.bat` hidden, no console window |
| [`Stop Gabada.bat`](./Stop%20Gabada.bat) | Kill `python.exe` hosting `desktop_launcher.py` and any installed `Gabada.exe` |

#### 💻 Manual start

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

#### 🖥 Desktop-style local launcher

```powershell
cd backend
.\.venv\Scripts\python.exe desktop_launcher.py
```

#### 🌐 Open

| Resource | URL |
| :--- | :--- |
| 🏠 App | <http://127.0.0.1:8000> |
| 📚 API docs | <http://127.0.0.1:8000/docs> |
| 💚 Health | <http://127.0.0.1:8000/health> |

## 🛠 Development

Run backend and frontend separately for hot reload.

#### Terminal 1 — Backend

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

#### Terminal 2 — Frontend

```powershell
cd frontend-web
npm.cmd run dev
```

| Resource | URL |
| :--- | :--- |
| ⚡ Frontend dev server | <http://127.0.0.1:5173> |
| 🔌 Backend API | <http://127.0.0.1:8000> |

> The frontend proxies API calls under `/api` to the backend.

### 🧰 Useful commands

<table>
<tr><th>Frontend</th><th>Backend</th></tr>
<tr>
<td>

```powershell
cd frontend-web
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
```

</td>
<td>

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
.\.venv\Scripts\python.exe -m py_compile main.py
```

</td>
</tr>
</table>

### 🔑 Environment variables

| Variable | Purpose |
| :--- | :--- |
| `GABADA_DATA_DIR` | Override the user data directory (database, logs, captured sessions, `sites.toml`). Useful for tests or running multiple instances side by side. |
| `GABADA_NO_BROWSER` | Set to `1` / `true` / `yes` to stop the desktop launcher from auto-opening a browser. |
| `PLAYWRIGHT_BROWSERS_PATH` | Set automatically when an `ms-playwright/` folder is bundled next to a frozen build. Override only if you keep Playwright browsers in a custom location. |

> Defaults work for normal local use — no `.env` file is required.

## 🏗 Architecture

```text
Gabada/
├─ backend/
│  ├─ api/                    # FastAPI routers (mounted under /api)
│  ├─ database/               # SQLite layer + Pydantic models
│  ├─ scheduler/              # APScheduler cron jobs
│  ├─ scraper/                # Playwright engine + sites.toml profiles
│  ├─ app_paths.py            # dev vs frozen path resolution
│  ├─ desktop_launcher.py     # standalone launcher (port 8000–8010)
│  ├─ main.py                 # FastAPI entry point
│  └─ requirements.txt
├─ frontend-web/
│  ├─ src/                    # React 19 + Vite + Tailwind v4
│  └─ package.json
├─ packaging/windows/         # PyInstaller spec, Inno Setup, build script
├─ start_gabada.bat           # one-click Windows launcher
├─ Start Gabada.vbs           # silent launcher
├─ Stop Gabada.bat            # process killer
└─ README.md
```

### 🧱 Stack

| Layer | Tech |
| :--- | :--- |
| 🐍 Backend | FastAPI, Playwright, APScheduler, aiosqlite, Pydantic v2 |
| ⚛ Frontend | React 19, Vite 8, TypeScript, Tailwind v4, TanStack Query, Zustand, Recharts |
| 🗄 Database | SQLite (WAL mode) at `backend/gabada.db` in dev — installed builds use the platform app-data folder |
| 📦 Packaging | PyInstaller + Inno Setup (Windows) |

## 🕸 Scraping Model

Gabada uses a **layered extraction approach**:

```
1️⃣  JSON-LD structured data
       ↓
2️⃣  Microdata and schema hints
       ↓
3️⃣  Smart page scan
       ↓
4️⃣  Common patterns and saved selectors
```

**Important behavior:**

- 🔄 Prices and stock are scraped outside the API request cycle
- 🌐 One Playwright browser instance is reused for the entire app lifetime
- 🧬 Per-domain selector overrides can be saved
- 🏷 `price` is treated as the regular or original price
- 💸 `discounted_price` is treated as the current sale price
- 📞 Extended status values such as `call_for_price`, `contact_store`, and `discontinued` can be preserved
- 🛡 Suspicious results can be reviewed and auto-corrected before saving

## 📜 Site Profiles

Gabada stores domain-level scrape profiles in [`backend/scraper/sites.toml`](./backend/scraper/sites.toml).

You can edit profiles in two ways:

- 🖥 In the app under `Settings → Site profiles`
- ✏️ Directly in `backend/scraper/sites.toml`

```toml
["example.com"]
platform = "generic"
wait_for = ".product-price"
selectors = { title = "h1", price = ".product-price", stock_status = ".availability" }
```

> Match is by hostname. `www.` is stripped automatically.

## 🔌 API

The backend API is mounted under `/api`. Interactive docs are available at [`/docs`](http://127.0.0.1:8000/docs).

<details>
<summary><b>Common endpoints</b> — click to expand</summary>

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/health` | Liveness probe |
| `GET` | `/api/products/` | List products |
| `GET` | `/api/stores/` | List stores |
| `GET` | `/api/categories/` | List categories |
| `GET` | `/api/settings/database/info` | Backup metadata |
| `GET` | `/api/settings/database/export` | Download backup archive |
| `POST` | `/api/settings/database/import` | Restore from backup |
| `POST` | `/api/import/woo/preview` | Preview WooCommerce catalog |
| `POST` | `/api/import/woo/import` | Commit selected Woo products |
| `POST` | `/api/import/file/preview` | Parse uploaded document |
| `POST` | `/api/import/file/commit` | Commit selected rows |
| `POST` | `/api/scraper/probe` | Preview a scrape |
| `POST` | `/api/scraper/selector-lab` | Discover selector candidates |
| `POST` | `/api/scraper/selector-lab/test` | Test a candidate profile |
| `PUT` | `/api/scraper/selector-lab/profile` | Save a per-domain profile |
| `POST` | `/api/scraper/scrape/{product_store_id}` | Scrape one link |
| `POST` | `/api/scraper/scrape-all` | Scrape every active link |

</details>

## 📦 Releases

### 🏷 Latest stable release

> 🟢 **`v0.1.3`** — current published Windows release line.

### 🏗 Windows installer builds

Packaging files live in [`packaging/windows`](./packaging/windows):

| File | Purpose |
| :--- | :--- |
| [`gabada.spec`](./packaging/windows/gabada.spec) | PyInstaller bundle definition |
| [`build_installer.ps1`](./packaging/windows/build_installer.ps1) | Local packaging script |
| [`gabada.iss`](./packaging/windows/gabada.iss) | Inno Setup installer |

Build locally:

```powershell
cd packaging\windows
.\build_installer.ps1
```

The script will:

- 🏗 Build the frontend bundle
- 📦 Install packaging requirements
- 🌐 Download the Playwright Chromium bundle for packaging
- 🐍 Create a desktop app bundle with PyInstaller
- 💿 Create an installer when Inno Setup 6 is installed

### 🚀 GitHub Releases

Publishing a GitHub Release triggers the workflow at [`.github/workflows/windows-release.yml`](./.github/workflows/windows-release.yml).

**Release assets:**

- 📦 `GabadaSetup-<tag>-windows-x64.exe`
- 🗜 `Gabada-<tag>-windows-x64.zip`

You can also run the workflow manually for an existing tag from GitHub Actions.

**Installed app behavior:**

- 🖥 Runs as a normal desktop app and opens the browser automatically
- 💾 Stores user data in a writable app-data folder instead of the install folder
- 🔁 Keeps using that same data folder when you install a newer version over the old one
- 📦 Bundles the frontend and default scraper profiles with the app

**Typical runtime data locations:**

| OS | Path |
| :--- | :--- |
| 🪟 Windows | `%APPDATA%\Gabada` |
| 🍎 macOS | `~/Library/Application Support/Gabada` |
| 🐧 Linux | `${XDG_DATA_HOME:-~/.local/share}/Gabada` |

## 🩺 Troubleshooting

<details>
<summary><b>The app opens but the UI is missing</b></summary>

Build the frontend first:

```powershell
cd frontend-web
npm.cmd run build
```

</details>

<details>
<summary><b><code>start_gabada.bat</code> says the venv is missing</b></summary>

Create the backend virtual environment and install dependencies:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

</details>

<details>
<summary><b>A store scrapes the wrong price or stock</b></summary>

- 🔍 Try `Probe` first to inspect the extracted result
- 🔬 Use `Selector Lab` to test stronger selectors
- 💾 Save a selector profile for the domain
- 🔄 Rescrape the affected products after the fix

</details>

<details>
<summary><b>A document import looks incomplete</b></summary>

- 📋 Confirm the correct sheet or table is present in the workbench
- 🔄 Remap columns before committing
- 🔗 Attach rows to the existing Gabada products you want to update
- 📄 For PDF price lists, make sure the product data appears in a table or column layout

</details>

<details>
<summary><b>I want to move or share my Gabada library</b></summary>

- ⚙ Open `Settings → Backup, restore, and share`
- 📤 Export a backup archive from the source machine
- 📥 Import that file on the destination machine
- 🛟 If anything goes wrong, use the safety copy path shown after import

</details>

<details>
<summary><b>API requests fail in development</b></summary>

Make sure both servers are running:

- 🔌 Backend on port `8000`
- ⚡ Vite on port `5173`

</details>

## 📄 License

[MIT](./LICENSE)

---

<div align="center">

Made for tracking prices the way you actually shop them.

</div>

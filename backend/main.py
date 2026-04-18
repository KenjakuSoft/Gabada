import asyncio
import sys
import logging
from contextlib import asynccontextmanager
from pathlib import Path

# Playwright requires ProactorEventLoop on Windows to spawn subprocesses
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database.db import init_db
from scraper.engine import start_browser, stop_browser
from scheduler.jobs import start_scheduler, stop_scheduler
from api import (
    products, stores, logs, scraper_routes, categories, activity,
    import_routes, settings,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await start_browser()
    await start_scheduler()
    yield
    stop_scheduler()
    await stop_browser()


app = FastAPI(title="Gabada API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categories.router)
app.include_router(products.router)
app.include_router(stores.router)
app.include_router(logs.router)
app.include_router(scraper_routes.router)
app.include_router(activity.router)
app.include_router(import_routes.router)
app.include_router(settings.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend-web" / "dist"
if _FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
else:
    logging.getLogger(__name__).info(
        "frontend-web/dist not found — skipping static mount (run `npm run build` in frontend-web)"
    )

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
from starlette.types import Scope

from database.db import init_db
from scraper.engine import start_browser, stop_browser
from scheduler.jobs import start_scheduler, stop_scheduler
from api import (
    products, stores, logs, scraper_routes, categories, activity,
    import_routes, settings,
)


class NoCacheHTMLStaticFiles(StaticFiles):
    """Serve the Vite SPA but tell browsers never to cache index.html.

    Hashed assets under /assets/* keep their long-lived cache; the entry HTML
    always revalidates so newly built bundles are picked up immediately.
    """

    async def get_response(self, path: str, scope: Scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        if path in ("", "index.html") or path.endswith(".html"):
            response.headers["Cache-Control"] = (
                "no-store, no-cache, must-revalidate, max-age=0"
            )
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

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
    app.mount(
        "/",
        NoCacheHTMLStaticFiles(directory=_FRONTEND_DIST, html=True),
        name="frontend",
    )
else:
    logging.getLogger(__name__).info(
        "frontend-web/dist not found — skipping static mount (run `npm run build` in frontend-web)"
    )

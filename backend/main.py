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
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from app_paths import configure_runtime_environment, frontend_dist_dir
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
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or Path(path).suffix != "":
                raise
            response = await super().get_response("index.html", scope)

        if response.status_code == 404 and Path(path).suffix == "":
            response = await super().get_response("index.html", scope)
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
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_runtime_environment()
    logger.info("Lifespan startup: begin")
    await init_db()
    logger.info("Lifespan startup: database ready")
    await start_browser()
    logger.info("Lifespan startup: Playwright ready")
    await start_scheduler()
    logger.info("Lifespan startup: scheduler ready")
    yield
    stop_scheduler()
    await stop_browser()
    logger.info("Lifespan shutdown: complete")


app = FastAPI(title="Gabada API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api"

app.include_router(categories.router, prefix=API_PREFIX)
app.include_router(products.router, prefix=API_PREFIX)
app.include_router(stores.router, prefix=API_PREFIX)
app.include_router(logs.router, prefix=API_PREFIX)
app.include_router(scraper_routes.router, prefix=API_PREFIX)
app.include_router(activity.router, prefix=API_PREFIX)
app.include_router(import_routes.router, prefix=API_PREFIX)
app.include_router(settings.router, prefix=API_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok"}

_FRONTEND_DIST = frontend_dist_dir()
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

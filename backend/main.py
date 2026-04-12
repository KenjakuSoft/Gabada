import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import init_db
from scraper.engine import start_browser, stop_browser
from scheduler.jobs import start_scheduler, stop_scheduler
from api import products, stores, logs, scraper_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await start_browser()
    start_scheduler()
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

app.include_router(products.router)
app.include_router(stores.router)
app.include_router(logs.router)
app.include_router(scraper_routes.router)


@app.get("/health")
async def health():
    return {"status": "ok"}

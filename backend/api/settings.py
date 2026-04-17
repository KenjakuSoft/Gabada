import logging
from fastapi import APIRouter, HTTPException

from apscheduler.triggers.cron import CronTrigger

from database.db import get_db
from database.models import Settings, SettingsUpdate
from scheduler.jobs import reschedule, next_run_time

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


async def _ensure_row(db) -> None:
    await db.execute("INSERT OR IGNORE INTO settings (id) VALUES (1)")
    await db.commit()


def _row_to_settings(r) -> Settings:
    return Settings(
        currency_code=r["currency_code"],
        currency_symbol=r["currency_symbol"],
        country_code=r["country_code"],
        timezone=r["timezone"],
        scrape_cron=r["scrape_cron"],
        scrape_enabled=bool(r["scrape_enabled"]),
        locale=r["locale"],
        theme=r["theme"],
        updated_at=r["updated_at"],
    )


@router.get("/", response_model=Settings)
async def get_settings() -> Settings:
    db = await get_db()
    try:
        await _ensure_row(db)
        rows = await db.execute_fetchall("SELECT * FROM settings WHERE id=1")
        return _row_to_settings(rows[0])
    finally:
        await db.close()


@router.put("/", response_model=Settings)
async def update_settings(body: SettingsUpdate) -> Settings:
    # Validate cron + timezone before touching the DB.
    if body.scrape_cron is not None or body.timezone is not None:
        current = None
        if body.scrape_cron is None or body.timezone is None:
            db = await get_db()
            try:
                await _ensure_row(db)
                rows = await db.execute_fetchall(
                    "SELECT scrape_cron, timezone FROM settings WHERE id=1"
                )
                current = rows[0] if rows else None
            finally:
                await db.close()
        cron_expr = body.scrape_cron if body.scrape_cron is not None else (
            current["scrape_cron"] if current else "0 8 * * *"
        )
        tz = body.timezone if body.timezone is not None else (
            current["timezone"] if current else "UTC"
        )
        try:
            CronTrigger.from_crontab(cron_expr, timezone=tz)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid cron or timezone: {e}",
            )

    updates: list[tuple[str, object]] = []
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "scrape_enabled":
            value = 1 if value else 0
        updates.append((field, value))

    db = await get_db()
    try:
        await _ensure_row(db)
        if updates:
            set_clause = ", ".join(f"{col}=?" for col, _ in updates)
            params = [v for _, v in updates]
            await db.execute(
                f"UPDATE settings SET {set_clause}, updated_at=CURRENT_TIMESTAMP WHERE id=1",
                tuple(params),
            )
            await db.commit()

        rows = await db.execute_fetchall("SELECT * FROM settings WHERE id=1")
        result = _row_to_settings(rows[0])
    finally:
        await db.close()

    # Pick up cron / timezone / enabled changes live.
    try:
        await reschedule()
    except Exception as e:
        logger.warning("Failed to reschedule after settings update: %s", e)

    return result


@router.get("/schedule/next")
async def schedule_next() -> dict:
    """Diagnostic: when will the next scheduled scrape run?"""
    return {"next_run_time": next_run_time()}

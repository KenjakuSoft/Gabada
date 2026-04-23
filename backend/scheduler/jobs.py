import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)
_scheduler = AsyncIOScheduler()
_JOB_ID = "daily_scrape"


async def _load_settings() -> tuple[str, str, bool]:
    """Return (cron_expr, timezone, enabled). Falls back to defaults if the
    settings table is missing or empty."""
    from database.db import get_db
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT scrape_cron, timezone, scrape_enabled FROM settings WHERE id=1"
        )
        if rows:
            r = rows[0]
            return (
                r["scrape_cron"] or "0 8 * * *",
                r["timezone"] or "UTC",
                bool(r["scrape_enabled"]),
            )
    except Exception as e:
        logger.warning("Could not load scheduler settings: %s", e)
    finally:
        await db.close()
    return ("0 8 * * *", "UTC", True)


def _install_job(cron_expr: str, timezone: str, enabled: bool) -> None:
    from api.scraper_routes import scrape_all_active
    try:
        _scheduler.remove_job(_JOB_ID)
    except Exception:
        pass
    if not enabled:
        logger.info("Scheduler: scrape disabled in settings; no job scheduled.")
        return
    try:
        trigger = CronTrigger.from_crontab(cron_expr, timezone=timezone)
    except Exception as e:
        logger.error("Invalid cron %r, falling back to '0 8 * * *': %s", cron_expr, e)
        trigger = CronTrigger.from_crontab("0 8 * * *", timezone=timezone)
    _scheduler.add_job(
        scrape_all_active,
        trigger=trigger,
        id=_JOB_ID,
        replace_existing=True,
        misfire_grace_time=3600,
    )
    logger.info("Scheduler: scrape scheduled with cron %r (tz=%s)", cron_expr, timezone)


async def start_scheduler() -> None:
    cron_expr, timezone, enabled = await _load_settings()
    _install_job(cron_expr, timezone, enabled)
    if not _scheduler.running:
        _scheduler.start()


async def reschedule() -> None:
    """Re-read settings and reinstall the job. Call after PUT /settings."""
    cron_expr, timezone, enabled = await _load_settings()
    _install_job(cron_expr, timezone, enabled)


def pause_scheduler() -> None:
    if _scheduler.running:
        _scheduler.pause()


async def resume_scheduler() -> None:
    if _scheduler.running:
        _scheduler.resume()
    else:
        await start_scheduler()


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def next_run_time() -> Optional[str]:
    job = _scheduler.get_job(_JOB_ID)
    if job and job.next_run_time:
        return job.next_run_time.isoformat()
    return None

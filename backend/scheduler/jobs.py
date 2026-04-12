import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)
_scheduler = AsyncIOScheduler()


def start_scheduler():
    from api.scraper_routes import scrape_all_active

    _scheduler.add_job(
        scrape_all_active,
        trigger=CronTrigger(hour=8, minute=0),   # 08:00 daily
        id="daily_scrape",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    _scheduler.start()
    logger.info("Scheduler started — daily scrape at 08:00")


def stop_scheduler():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

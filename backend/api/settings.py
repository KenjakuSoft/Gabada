import asyncio
import inspect
import json
import logging
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from apscheduler.triggers.cron import CronTrigger

from app_paths import data_dir, database_path, is_frozen, site_profiles_path
from database.db import get_db, init_db
from database.models import (
    DatabaseCounts,
    DatabaseImportResponse,
    DatabaseTransferInfo,
    Settings,
    SettingsUpdate,
    UpdateCheckResponse,
)
from scheduler.jobs import next_run_time, pause_scheduler, reschedule, resume_scheduler
from services.backup_bundle import (
    backup_sqlite_file as _backup_sqlite_file,
    create_backup_bundle as _create_backup_bundle,
    extract_backup_bundle as _extract_backup_bundle,
    restore_live_database as _restore_live_database,
    restore_site_profiles as _restore_site_profiles,
    timestamp_slug as _timestamp_slug,
    validate_backup_database as _validate_backup_database,
    BACKUP_DB_NAME as _BACKUP_DB_NAME,
)
from services.update_checker import check_for_updates, update_check_error

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])
_TRANSFER_LOCK = asyncio.Lock()
_ALLOWED_IMPORT_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".zip"}


async def _ensure_row(db) -> None:
    await db.execute("INSERT OR IGNORE INTO settings (id) VALUES (1)")
    await db.commit()


def _row_to_settings(r) -> Settings:
    exchange_rates: dict[str, float] = {}
    try:
        parsed_rates = json.loads(r["exchange_rates"] or "{}")
    except (TypeError, ValueError):
        parsed_rates = {}

    # Drop only the unusable entries. One corrupt rate must not discard every
    # other locally configured conversion.
    if isinstance(parsed_rates, dict):
        for code, rate in parsed_rates.items():
            normalized_code = str(code or "").strip().upper()
            if not normalized_code:
                continue
            try:
                numeric_rate = float(rate)
            except (TypeError, ValueError):
                continue
            if math.isfinite(numeric_rate) and numeric_rate > 0:
                exchange_rates[normalized_code] = numeric_rate

    return Settings(
        currency_code=r["currency_code"],
        currency_symbol=r["currency_symbol"],
        country_code=r["country_code"],
        timezone=r["timezone"],
        scrape_cron=r["scrape_cron"],
        scrape_enabled=bool(r["scrape_enabled"]),
        locale=r["locale"],
        price_display_mode=r["price_display_mode"],
        exchange_rates=exchange_rates,
        theme=r["theme"],
        updated_at=r["updated_at"],
    )


def _backups_dir() -> Path:
    path = data_dir() / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _cleanup_directory(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)


def _database_transfer_info() -> DatabaseTransferInfo:
    live_path = database_path()
    counts = DatabaseCounts()
    modified_at = None
    if live_path.exists():
        counts = _validate_backup_database(live_path)
        modified_at = datetime.fromtimestamp(
            live_path.stat().st_mtime,
            tz=timezone.utc,
        )

    profiles_path = site_profiles_path()
    stamp = _timestamp_slug()
    return DatabaseTransferInfo(
        data_dir=str(data_dir()),
        database_path=str(live_path),
        site_profiles_path=str(profiles_path),
        site_profiles_exists=profiles_path.exists(),
        install_mode="desktop" if is_frozen() else "source",
        recommended_export_name=f"gabada-backup-{stamp}.zip",
        counts=counts,
        database_modified_at=modified_at,
    )


async def _run_shutdown_callback(callback) -> None:
    await asyncio.sleep(0.2)
    result = callback()
    if inspect.isawaitable(result):
        await result


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
        if field == "price_display_mode":
            value = str(value or "regional").strip().lower()
            if value not in {"regional", "source"}:
                raise HTTPException(
                    status_code=400,
                    detail="price_display_mode must be regional or source",
                )
        if field == "exchange_rates":
            if not isinstance(value, dict):
                raise HTTPException(
                    status_code=400,
                    detail="exchange_rates must be a currency-rate map",
                )
            normalized_rates: dict[str, float] = {}
            for code, rate in value.items():
                normalized_code = str(code or "").strip().upper()
                if not normalized_code:
                    continue
                try:
                    numeric_rate = float(rate)
                except (TypeError, ValueError):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid exchange rate for {normalized_code}",
                    )
                if not math.isfinite(numeric_rate) or numeric_rate <= 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Exchange rate for {normalized_code} must be a finite number greater than 0",
                    )
                normalized_rates[normalized_code] = numeric_rate
            value = json.dumps(normalized_rates, sort_keys=True)
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


@router.get("/database/info", response_model=DatabaseTransferInfo)
async def get_database_info() -> DatabaseTransferInfo:
    return await asyncio.to_thread(_database_transfer_info)


@router.get("/updates/latest", response_model=UpdateCheckResponse)
async def get_latest_update() -> UpdateCheckResponse:
    try:
        return await check_for_updates()
    except Exception as exc:
        logger.warning("Failed to check for updates: %s", exc)
        return update_check_error(str(exc))


@router.post("/shutdown")
async def shutdown_app(
    request: Request, background_tasks: BackgroundTasks
) -> dict[str, str]:
    callback = getattr(request.app.state, "request_shutdown", None)
    if not callable(callback):
        raise HTTPException(
            status_code=503,
            detail="Shutdown is only available when Gabada is running from its desktop launcher.",
        )

    background_tasks.add_task(_run_shutdown_callback, callback)
    return {"status": "shutting_down"}


@router.get("/database/export")
async def export_database(background_tasks: BackgroundTasks):
    await init_db()
    stamp = _timestamp_slug()
    stage_dir = _backups_dir() / f"export-{stamp}"
    snapshot_path = stage_dir / _BACKUP_DB_NAME
    bundle_name = f"gabada-backup-{stamp}.zip"
    bundle_path = stage_dir / bundle_name
    stage_dir.mkdir(parents=True, exist_ok=True)

    async with _TRANSFER_LOCK:
        await asyncio.to_thread(_backup_sqlite_file, database_path(), snapshot_path)
        counts = await asyncio.to_thread(_validate_backup_database, snapshot_path)
        await asyncio.to_thread(
            _create_backup_bundle,
            snapshot_path,
            bundle_path,
            counts=counts,
        )

    background_tasks.add_task(_cleanup_directory, str(stage_dir))
    return FileResponse(
        path=bundle_path,
        media_type="application/zip",
        filename=bundle_name,
    )


@router.post("/database/import", response_model=DatabaseImportResponse)
async def import_database(file: UploadFile = File(...)) -> DatabaseImportResponse:
    source_name = (file.filename or "").strip() or "gabada-backup"
    suffix = Path(source_name).suffix.lower()
    if suffix not in _ALLOWED_IMPORT_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail="Upload a .zip, .db, .sqlite, or .sqlite3 backup file",
        )

    await init_db()
    stamp = _timestamp_slug()
    stage_dir = _backups_dir() / f"import-{stamp}"
    stage_dir.mkdir(parents=True, exist_ok=True)
    upload_path = stage_dir / f"uploaded{suffix}"
    previous_backup_path = _backups_dir() / f"gabada-before-import-{stamp}.db"

    try:
        with upload_path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                handle.write(chunk)

        async with _TRANSFER_LOCK:
            pause_scheduler()
            try:
                if suffix == ".zip":
                    import_db_path, import_profiles_path = await asyncio.to_thread(
                        _extract_backup_bundle,
                        upload_path,
                        stage_dir,
                    )
                else:
                    import_db_path = upload_path
                    import_profiles_path = None

                counts = await asyncio.to_thread(
                    _validate_backup_database,
                    import_db_path,
                )
                await asyncio.to_thread(
                    _backup_sqlite_file,
                    database_path(),
                    previous_backup_path,
                )
                await asyncio.to_thread(
                    _restore_live_database,
                    import_db_path,
                )
                site_profiles_restored = False
                if import_profiles_path is not None:
                    await asyncio.to_thread(
                        _restore_site_profiles,
                        import_profiles_path,
                    )
                    site_profiles_restored = True

                await init_db()
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            finally:
                try:
                    await reschedule()
                except Exception as exc:  # pragma: no cover - runtime recovery
                    logger.warning("Failed to reschedule after import: %s", exc)
                try:
                    await resume_scheduler()
                except Exception as exc:  # pragma: no cover - runtime recovery
                    logger.warning("Failed to restart scheduler after import: %s", exc)

        return DatabaseImportResponse(
            source_name=source_name,
            backup_path=str(previous_backup_path),
            site_profiles_restored=site_profiles_restored,
            counts=counts,
        )
    finally:
        await file.close()
        shutil.rmtree(stage_dir, ignore_errors=True)

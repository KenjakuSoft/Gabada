import asyncio
import json
import logging
import shutil
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
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
)
from scheduler.jobs import next_run_time, pause_scheduler, reschedule, resume_scheduler

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])
_TRANSFER_LOCK = asyncio.Lock()
_BACKUP_DB_NAME = "gabada.db"
_BACKUP_SITE_PROFILES_NAME = "sites.toml"
_BACKUP_METADATA_NAME = "metadata.json"
_ALLOWED_IMPORT_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".zip"}
_REQUIRED_BACKUP_TABLES = {"products", "stores", "product_stores", "price_logs", "settings"}


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


def _backups_dir() -> Path:
    path = data_dir() / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _read_database_counts(conn: sqlite3.Connection) -> DatabaseCounts:
    counts: dict[str, int] = {}
    for table in ("products", "stores", "categories", "product_stores", "price_logs"):
        try:
            row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            counts[table] = int(row[0] if row else 0)
        except sqlite3.Error:
            counts[table] = 0
    return DatabaseCounts(**counts)


def _validate_backup_database(path: Path) -> DatabaseCounts:
    try:
        conn = sqlite3.connect(str(path))
    except sqlite3.Error as exc:
        raise ValueError(f"Could not open SQLite backup: {exc}") from exc

    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        missing = sorted(_REQUIRED_BACKUP_TABLES - tables)
        if missing:
            raise ValueError(
                "Backup is missing required tables: " + ", ".join(missing)
            )
        return _read_database_counts(conn)
    except sqlite3.Error as exc:
        raise ValueError(f"Backup is not a valid SQLite database: {exc}") from exc
    finally:
        conn.close()


def _backup_sqlite_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    with sqlite3.connect(str(source)) as src, sqlite3.connect(str(target)) as dst:
        src.backup(dst)
        dst.commit()


def _create_backup_bundle(snapshot_path: Path, bundle_path: Path, *, counts: DatabaseCounts) -> None:
    metadata = {
        "format": "gabada-backup",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "install_mode": "desktop" if is_frozen() else "source",
        "counts": counts.model_dump(),
        "includes_site_profiles": site_profiles_path().exists(),
    }
    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(snapshot_path, arcname=_BACKUP_DB_NAME)
        profiles_path = site_profiles_path()
        if profiles_path.exists():
            archive.write(profiles_path, arcname=_BACKUP_SITE_PROFILES_NAME)
        archive.writestr(_BACKUP_METADATA_NAME, json.dumps(metadata, indent=2))


def _extract_backup_bundle(bundle_path: Path, stage_dir: Path) -> tuple[Path, Path | None]:
    extracted_db = stage_dir / _BACKUP_DB_NAME
    extracted_profiles: Path | None = None
    with zipfile.ZipFile(bundle_path, "r") as archive:
        members = archive.namelist()
        db_member = next(
            (
                name
                for name in members
                if Path(name).suffix.lower() in {".db", ".sqlite", ".sqlite3"}
            ),
            None,
        )
        if db_member is None:
            raise ValueError("Backup archive does not contain a SQLite database")
        extracted_db.write_bytes(archive.read(db_member))

        profiles_member = next(
            (name for name in members if Path(name).name == _BACKUP_SITE_PROFILES_NAME),
            None,
        )
        if profiles_member is not None:
            extracted_profiles = stage_dir / _BACKUP_SITE_PROFILES_NAME
            extracted_profiles.write_bytes(archive.read(profiles_member))

    return extracted_db, extracted_profiles


def _restore_live_database(source_path: Path) -> None:
    live_path = database_path()
    live_path.parent.mkdir(parents=True, exist_ok=True)
    if not live_path.exists():
        sqlite3.connect(str(live_path)).close()
    with sqlite3.connect(str(source_path)) as src, sqlite3.connect(str(live_path)) as dst:
        src.backup(dst)
        dst.commit()


def _restore_site_profiles(source_path: Path) -> None:
    target = site_profiles_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, target)


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


@router.get("/database/info", response_model=DatabaseTransferInfo)
async def get_database_info() -> DatabaseTransferInfo:
    return await asyncio.to_thread(_database_transfer_info)


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

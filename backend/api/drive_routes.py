"""Manual Google Drive sync endpoints.

Companion to ``services/drive_sync.py``. Endpoints:

- ``GET    /drive/status``                 — sign-in + config state
- ``POST   /drive/credentials``            — save OAuth client_id/secret
- ``DELETE /drive/credentials``            — clear OAuth client_id/secret
- ``POST   /drive/auth/start``             — begin loopback OAuth flow
- ``GET    /drive/auth/poll``              — poll for code, exchange for tokens
- ``POST   /drive/auth/cancel``            — abort an in-flight sign-in
- ``POST   /drive/auth/signout``           — revoke + clear local tokens
- ``POST   /drive/snapshots/push``         — upload current DB as snapshot
- ``GET    /drive/snapshots``              — list snapshots (newest first)
- ``POST   /drive/snapshots/restore/{id}`` — download + restore a snapshot
- ``DELETE /drive/snapshots/{id}``         — delete a snapshot from Drive

Concurrency: snapshots are point-in-time exports/imports — *not* live sync.
The push/restore flows take the same ``_TRANSFER_LOCK`` used by the manual
backup endpoints so they cannot interleave.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app_paths import data_dir, database_path
from database.db import init_db
from database.models import (
    DriveAuthStartResponse,
    DriveCredentialsRequest,
    DrivePushResponse,
    DriveRestoreResponse,
    DriveSnapshot,
    DriveSnapshotList,
    DriveStatus,
)
from scheduler.jobs import pause_scheduler, resume_scheduler
from services import drive_sync
from services.backup_bundle import (
    backup_sqlite_file,
    create_backup_bundle,
    extract_backup_bundle,
    restore_live_database,
    restore_site_profiles,
    timestamp_slug,
    validate_backup_database,
    BACKUP_DB_NAME,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/drive", tags=["drive"])

# Re-use the same lock as settings.py so manual import/export and Drive push/
# restore cannot run concurrently.
from api.settings import _TRANSFER_LOCK  # noqa: E402


def _backups_dir() -> Path:
    path = data_dir() / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _cleanup_directory(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)


def _require_credentials() -> drive_sync.DriveCredentials:
    creds = drive_sync.load_credentials()
    if creds is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Google OAuth credentials are not configured. "
                "Add a Desktop OAuth client_id and client_secret in Settings → Drive Sync."
            ),
        )
    return creds


async def _require_access_token() -> str:
    creds = _require_credentials()
    try:
        tokens = await drive_sync.refresh_if_needed(creds.client_id, creds.client_secret)
    except RuntimeError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return tokens.access_token


def _to_snapshot(item: dict) -> DriveSnapshot:
    def _parse_dt(value) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    size_raw = item.get("size")
    size = int(size_raw) if size_raw is not None else None
    return DriveSnapshot(
        id=item["id"],
        name=item.get("name") or item["id"],
        size=size,
        created_time=_parse_dt(item.get("createdTime")),
        modified_time=_parse_dt(item.get("modifiedTime")),
    )


# ── Status & credentials ─────────────────────────────────────────────────────


@router.get("/status", response_model=DriveStatus)
async def get_status() -> DriveStatus:
    creds = drive_sync.load_credentials()
    tokens = drive_sync.load_tokens()
    last_push = drive_sync.load_last_push() or {}
    last_at = last_push.get("at")
    parsed_last_at: Optional[datetime] = None
    if last_at:
        try:
            parsed_last_at = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
        except ValueError:
            parsed_last_at = None
    return DriveStatus(
        configured=creds is not None,
        signed_in=tokens is not None,
        account_email=tokens.account_email if tokens else None,
        auth_in_progress=drive_sync.auth_in_progress(),
        last_push_at=parsed_last_at,
        last_push_name=last_push.get("name"),
    )


@router.post("/credentials", response_model=DriveStatus)
async def save_credentials(payload: DriveCredentialsRequest) -> DriveStatus:
    client_id = payload.client_id.strip()
    client_secret = payload.client_secret.strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="client_id and client_secret are required")
    drive_sync.save_credentials(
        drive_sync.DriveCredentials(client_id=client_id, client_secret=client_secret)
    )
    return await get_status()


@router.delete("/credentials", response_model=DriveStatus)
async def delete_credentials() -> DriveStatus:
    creds = drive_sync.load_credentials()
    tokens = drive_sync.load_tokens()
    if tokens is not None and creds is not None:
        try:
            await drive_sync.revoke(creds.client_id, creds.client_secret)
        except Exception as exc:  # pragma: no cover - best-effort
            logger.info("Drive: revoke during credential clear failed (%s)", exc)
    drive_sync.clear_credentials()
    drive_sync.clear_tokens()
    drive_sync.cancel_auth()
    return await get_status()


# ── Auth flow ────────────────────────────────────────────────────────────────


@router.post("/auth/start", response_model=DriveAuthStartResponse)
async def auth_start() -> DriveAuthStartResponse:
    creds = _require_credentials()
    try:
        url = drive_sync.begin_auth(creds.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DriveAuthStartResponse(auth_url=url)


@router.get("/auth/poll", response_model=DriveStatus)
async def auth_poll() -> DriveStatus:
    creds = _require_credentials()
    try:
        await drive_sync.poll_auth(creds.client_id, creds.client_secret)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await get_status()


@router.post("/auth/cancel", response_model=DriveStatus)
async def auth_cancel() -> DriveStatus:
    drive_sync.cancel_auth()
    return await get_status()


@router.post("/auth/signout", response_model=DriveStatus)
async def auth_signout() -> DriveStatus:
    creds = drive_sync.load_credentials()
    if creds is not None:
        try:
            await drive_sync.revoke(creds.client_id, creds.client_secret)
        except Exception as exc:  # pragma: no cover - best-effort
            logger.info("Drive: revoke during sign-out failed (%s)", exc)
    drive_sync.clear_tokens()
    drive_sync.cancel_auth()
    return await get_status()


# ── Snapshots ────────────────────────────────────────────────────────────────


@router.get("/snapshots", response_model=DriveSnapshotList)
async def list_snapshots() -> DriveSnapshotList:
    access_token = await _require_access_token()
    try:
        items = await drive_sync.list_snapshots(access_token)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return DriveSnapshotList(snapshots=[_to_snapshot(it) for it in items])


@router.post("/snapshots/push", response_model=DrivePushResponse)
async def push_snapshot(background_tasks: BackgroundTasks) -> DrivePushResponse:
    access_token = await _require_access_token()
    await init_db()

    stamp = timestamp_slug()
    stage_dir = _backups_dir() / f"drive-push-{stamp}"
    snapshot_path = stage_dir / BACKUP_DB_NAME
    bundle_name = drive_sync.make_snapshot_filename(stamp)
    bundle_path = stage_dir / bundle_name
    stage_dir.mkdir(parents=True, exist_ok=True)

    async with _TRANSFER_LOCK:
        try:
            await asyncio.to_thread(backup_sqlite_file, database_path(), snapshot_path)
            counts = await asyncio.to_thread(validate_backup_database, snapshot_path)
            await asyncio.to_thread(
                create_backup_bundle,
                snapshot_path,
                bundle_path,
                counts=counts,
            )
        except ValueError as exc:
            background_tasks.add_task(_cleanup_directory, str(stage_dir))
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        try:
            uploaded = await drive_sync.upload_snapshot(access_token, bundle_path, bundle_name)
        except RuntimeError as exc:
            background_tasks.add_task(_cleanup_directory, str(stage_dir))
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    pruned = 0
    try:
        pruned = await drive_sync.prune_old_snapshots(access_token)
    except RuntimeError as exc:
        logger.warning("Drive: prune after push failed: %s", exc)

    drive_sync.save_last_push(name=uploaded.get("name") or bundle_name, snapshot_id=uploaded["id"])
    background_tasks.add_task(_cleanup_directory, str(stage_dir))

    return DrivePushResponse(
        snapshot=_to_snapshot(uploaded),
        pruned=pruned,
        counts=counts,
    )


@router.post("/snapshots/restore/{snapshot_id}", response_model=DriveRestoreResponse)
async def restore_snapshot(snapshot_id: str) -> DriveRestoreResponse:
    access_token = await _require_access_token()
    await init_db()

    stamp = timestamp_slug()
    stage_dir = _backups_dir() / f"drive-restore-{stamp}"
    stage_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = stage_dir / "snapshot.zip"
    previous_backup_path = _backups_dir() / f"gabada-before-drive-restore-{stamp}.db"

    try:
        try:
            await drive_sync.download_snapshot(access_token, snapshot_id, bundle_path)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        async with _TRANSFER_LOCK:
            pause_scheduler()
            try:
                try:
                    import_db_path, import_profiles_path = await asyncio.to_thread(
                        extract_backup_bundle,
                        bundle_path,
                        stage_dir,
                    )
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc

                try:
                    counts = await asyncio.to_thread(
                        validate_backup_database,
                        import_db_path,
                    )
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc

                await asyncio.to_thread(
                    backup_sqlite_file,
                    database_path(),
                    previous_backup_path,
                )
                await asyncio.to_thread(restore_live_database, import_db_path)

                site_profiles_restored = False
                if import_profiles_path is not None:
                    await asyncio.to_thread(
                        restore_site_profiles,
                        import_profiles_path,
                    )
                    site_profiles_restored = True

                await init_db()
            finally:
                try:
                    await resume_scheduler()
                except Exception as exc:  # pragma: no cover
                    logger.warning("Failed to restart scheduler after Drive restore: %s", exc)

        # Best-effort: get the friendly name back from Drive list
        snapshot_name = snapshot_id
        try:
            items = await drive_sync.list_snapshots(access_token)
            match = next((it for it in items if it.get("id") == snapshot_id), None)
            if match and match.get("name"):
                snapshot_name = match["name"]
        except RuntimeError:
            pass

        return DriveRestoreResponse(
            snapshot_id=snapshot_id,
            snapshot_name=snapshot_name,
            backup_path=str(previous_backup_path),
            site_profiles_restored=site_profiles_restored,
            counts=counts,
        )
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)


@router.delete("/snapshots/{snapshot_id}")
async def delete_snapshot(snapshot_id: str) -> dict[str, str]:
    access_token = await _require_access_token()
    try:
        await drive_sync.delete_snapshot(access_token, snapshot_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": "deleted", "id": snapshot_id}

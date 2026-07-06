"""Shared helpers for creating and restoring Gabada backup bundles.

A *bundle* is a ZIP containing the live SQLite database plus (optionally) the
user-edited ``sites.toml`` and a metadata file. The helpers here are reused by:

- ``api/settings.py`` — manual export/import via the Settings page
- ``api/drive_routes.py`` — push/restore snapshots to/from Google Drive

All filesystem and ``sqlite3`` work is synchronous; callers should run these
through ``asyncio.to_thread`` from request handlers.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app_paths import database_path, is_frozen, site_profiles_path
from database.models import DatabaseCounts


BACKUP_DB_NAME = "gabada.db"
BACKUP_SITE_PROFILES_NAME = "sites.toml"
BACKUP_METADATA_NAME = "metadata.json"
REQUIRED_BACKUP_TABLES = frozenset(
    {"products", "stores", "product_stores", "price_logs", "settings"}
)
# Decompression ceilings for untrusted bundles (a restored snapshot may come
# from a shared file or a compromised Drive account). A tiny zip can declare
# or decompress to many GB — cap what we are willing to inflate.
MAX_DB_MEMBER_BYTES = 2 * 1024**3  # 2 GiB
MAX_PROFILES_MEMBER_BYTES = 10 * 1024**2  # 10 MiB


def read_database_counts(conn: sqlite3.Connection) -> DatabaseCounts:
    counts: dict[str, int] = {}
    for table in ("products", "stores", "categories", "product_stores", "price_logs"):
        try:
            row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            counts[table] = int(row[0] if row else 0)
        except sqlite3.Error:
            counts[table] = 0
    return DatabaseCounts(**counts)


def validate_backup_database(path: Path) -> DatabaseCounts:
    """Open ``path`` as SQLite and verify it has the required tables.

    Raises ``ValueError`` with a user-readable message if the file is invalid.
    """
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
        missing = sorted(REQUIRED_BACKUP_TABLES - tables)
        if missing:
            raise ValueError(
                "Backup is missing required tables: " + ", ".join(missing)
            )
        return read_database_counts(conn)
    except sqlite3.Error as exc:
        raise ValueError(f"Backup is not a valid SQLite database: {exc}") from exc
    finally:
        conn.close()


def backup_sqlite_file(source: Path, target: Path) -> None:
    """Hot-copy ``source`` to ``target`` using SQLite's online backup API."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    with sqlite3.connect(str(source)) as src, sqlite3.connect(str(target)) as dst:
        src.backup(dst)
        dst.commit()


def create_backup_bundle(
    snapshot_path: Path,
    bundle_path: Path,
    *,
    counts: DatabaseCounts,
) -> None:
    """Zip the snapshot DB, the live ``sites.toml`` (if any), and metadata."""
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
        archive.write(snapshot_path, arcname=BACKUP_DB_NAME)
        profiles_path = site_profiles_path()
        if profiles_path.exists():
            archive.write(profiles_path, arcname=BACKUP_SITE_PROFILES_NAME)
        archive.writestr(BACKUP_METADATA_NAME, json.dumps(metadata, indent=2))


def _extract_member_capped(
    archive: zipfile.ZipFile,
    member: str,
    target: Path,
    *,
    max_bytes: int,
) -> None:
    """Stream one member to ``target``, refusing to inflate past ``max_bytes``.

    The declared size is checked first for a fast, friendly error; the
    streaming cap holds even if the zip header lies about ``file_size``.
    """
    info = archive.getinfo(member)
    if info.file_size > max_bytes:
        raise ValueError(
            f"Backup member '{member}' is too large "
            f"({info.file_size} bytes; limit {max_bytes})"
        )
    remaining = max_bytes
    with archive.open(member) as src, target.open("wb") as dst:
        while chunk := src.read(1024 * 1024):
            remaining -= len(chunk)
            if remaining < 0:
                raise ValueError(
                    f"Backup member '{member}' decompressed past its limit "
                    f"({max_bytes} bytes)"
                )
            dst.write(chunk)


def extract_backup_bundle(
    bundle_path: Path,
    stage_dir: Path,
) -> tuple[Path, Optional[Path]]:
    """Extract the SQLite DB and (if present) ``sites.toml`` from a bundle zip.

    Returns ``(db_path, site_profiles_path_or_None)``.
    """
    extracted_db = stage_dir / BACKUP_DB_NAME
    extracted_profiles: Optional[Path] = None
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
        _extract_member_capped(
            archive, db_member, extracted_db, max_bytes=MAX_DB_MEMBER_BYTES
        )

        profiles_member = next(
            (name for name in members if Path(name).name == BACKUP_SITE_PROFILES_NAME),
            None,
        )
        if profiles_member is not None:
            extracted_profiles = stage_dir / BACKUP_SITE_PROFILES_NAME
            _extract_member_capped(
                archive,
                profiles_member,
                extracted_profiles,
                max_bytes=MAX_PROFILES_MEMBER_BYTES,
            )

    return extracted_db, extracted_profiles


def restore_live_database(source_path: Path) -> None:
    """Replace the live database file with ``source_path``'s contents."""
    live_path = database_path()
    live_path.parent.mkdir(parents=True, exist_ok=True)
    if not live_path.exists():
        sqlite3.connect(str(live_path)).close()
    with sqlite3.connect(str(source_path)) as src, sqlite3.connect(str(live_path)) as dst:
        src.backup(dst)
        dst.commit()


def restore_site_profiles(source_path: Path) -> None:
    target = site_profiles_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, target)


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

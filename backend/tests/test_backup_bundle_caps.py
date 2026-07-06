from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from typing import Optional

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest  # noqa: E402

from services import backup_bundle  # noqa: E402


def _write_bundle(
    path: Path, db_bytes: bytes, profiles_bytes: Optional[bytes] = None
) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(backup_bundle.BACKUP_DB_NAME, db_bytes)
        if profiles_bytes is not None:
            archive.writestr(backup_bundle.BACKUP_SITE_PROFILES_NAME, profiles_bytes)


def test_extract_rejects_oversized_db_member(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(backup_bundle, "MAX_DB_MEMBER_BYTES", 16)
    bundle = tmp_path / "bundle.zip"
    _write_bundle(bundle, b"x" * 64)
    with pytest.raises(ValueError, match="too large"):
        backup_bundle.extract_backup_bundle(bundle, tmp_path)


def test_extract_rejects_oversized_profiles_member(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(backup_bundle, "MAX_PROFILES_MEMBER_BYTES", 8)
    bundle = tmp_path / "bundle.zip"
    _write_bundle(bundle, b"db", profiles_bytes=b"y" * 64)
    with pytest.raises(ValueError, match="too large"):
        backup_bundle.extract_backup_bundle(bundle, tmp_path)


def test_extract_streams_members_within_caps(tmp_path) -> None:
    bundle = tmp_path / "bundle.zip"
    _write_bundle(bundle, b"db-bytes", profiles_bytes=b"profiles")
    db_path, profiles_path = backup_bundle.extract_backup_bundle(bundle, tmp_path)
    assert db_path.read_bytes() == b"db-bytes"
    assert profiles_path is not None
    assert profiles_path.read_bytes() == b"profiles"

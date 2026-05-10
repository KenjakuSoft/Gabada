from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


APP_NAME = "Gabada"
_ENV_DATA_DIR = "GABADA_DATA_DIR"
_ENV_BROWSERS_PATH = "PLAYWRIGHT_BROWSERS_PATH"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def bundle_root() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return repo_root()


def backend_dir() -> Path:
    return repo_root() / "backend"


def _default_user_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / APP_NAME


def data_dir() -> Path:
    override = os.environ.get(_ENV_DATA_DIR)
    if override:
        return Path(override).expanduser().resolve()
    if is_frozen():
        return _default_user_data_dir()
    return backend_dir()


def sessions_dir() -> Path:
    return data_dir() / "sessions"


def logs_dir() -> Path:
    return data_dir() / "logs"


def database_path() -> Path:
    return data_dir() / "gabada.db"


def bundled_sites_toml_path() -> Path:
    return bundle_root() / "backend" / "scraper" / "sites.toml"


def site_profiles_path() -> Path:
    if not is_frozen():
        return backend_dir() / "scraper" / "sites.toml"

    target = data_dir() / "sites.toml"
    if target.exists():
        return target

    source = bundled_sites_toml_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.exists():
        shutil.copyfile(source, target)
    else:
        target.touch()
    return target


def frontend_dist_dir() -> Path:
    if is_frozen():
        return bundle_root() / "frontend-web" / "dist"
    return repo_root() / "frontend-web" / "dist"


def _allowed_storage_state_bases() -> list[Path]:
    """Allowed base dirs for Playwright storage_state files.

    - ``sessions_dir()`` — preferred location in all modes; honors
      ``GABADA_DATA_DIR`` overrides.
    - ``backend_dir()`` in source checkouts — preserves backwards
      compatibility with relative paths historically resolved against the
      backend directory (e.g. ``"stores/store-1-login.json"``).
    """
    bases: list[Path] = [sessions_dir().resolve()]
    if not is_frozen():
        bases.append(backend_dir().resolve())
    return bases


def resolve_storage_state_path(value: str, *, for_write: bool = False) -> Path:
    """Resolve a Playwright ``storage_state`` path safely.

    Paths are confined to ``sessions_dir()`` (and, in source checkouts,
    ``backend_dir()`` for backwards compatibility). Absolute paths and
    ``..`` traversal that escape every allowed base are rejected so a
    hostile request cannot use this primitive to read or overwrite
    arbitrary files (e.g. SSH keys, system DLLs, the live DB).
    """
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Path is required")

    path = Path(raw).expanduser()
    bases = _allowed_storage_state_bases()
    primary_base = bases[0]
    if path.is_absolute():
        candidate = path.resolve()
    else:
        candidate = (primary_base / path).resolve()

    if not any(candidate.is_relative_to(base) for base in bases):
        raise ValueError(
            "storage_state_path must stay inside the Gabada sessions directory"
        )

    if for_write:
        candidate.parent.mkdir(parents=True, exist_ok=True)
    return candidate


def configure_runtime_environment() -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    sessions_dir().mkdir(parents=True, exist_ok=True)
    logs_dir().mkdir(parents=True, exist_ok=True)

    bundled_browsers = bundle_root() / "ms-playwright"
    if bundled_browsers.exists():
        os.environ.setdefault(_ENV_BROWSERS_PATH, str(bundled_browsers))

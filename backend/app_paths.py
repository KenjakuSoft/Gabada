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


def resolve_storage_state_path(value: str, *, for_write: bool = False) -> Path:
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Path is required")

    path = Path(raw).expanduser()
    if not path.is_absolute():
        base = sessions_dir() if is_frozen() else backend_dir()
        path = base / path
    resolved = path.resolve()
    if for_write:
        resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def configure_runtime_environment() -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    sessions_dir().mkdir(parents=True, exist_ok=True)
    logs_dir().mkdir(parents=True, exist_ok=True)

    bundled_browsers = bundle_root() / "ms-playwright"
    if bundled_browsers.exists():
        os.environ.setdefault(_ENV_BROWSERS_PATH, str(bundled_browsers))

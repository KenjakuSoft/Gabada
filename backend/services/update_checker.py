from __future__ import annotations

import platform as platform_module
import re
import sys
from typing import Any, Optional

import httpx

from app_paths import is_frozen
from app_version import APP_REPOSITORY, APP_VERSION, normalized_version
from database.models import UpdateAsset, UpdateCheckResponse


_GITHUB_LATEST_RELEASE_URL = (
    f"https://api.github.com/repos/{APP_REPOSITORY}/releases/latest"
)
_VERSION_RE = re.compile(r"^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?")


def current_platform() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    return sys.platform


def current_arch() -> str:
    machine = platform_module.machine().lower()
    if machine in {"amd64", "x86_64"}:
        return "x64"
    if machine in {"arm64", "aarch64"}:
        return "arm64"
    return machine or "unknown"


def version_parts(value: str) -> tuple[int, int, int]:
    match = _VERSION_RE.match(value.strip())
    if not match:
        return (0, 0, 0)
    major, minor, patch = match.groups()
    return (int(major), int(minor or 0), int(patch or 0))


def is_newer_version(candidate: str, current: str) -> bool:
    return version_parts(candidate) > version_parts(current)


def _asset_kind(name: str) -> str:
    lowered = name.lower()
    if lowered.endswith(".json") and "update" in lowered:
        return "manifest"
    if lowered.endswith(".exe"):
        return "installer"
    if lowered.endswith(".zip") or lowered.endswith(".tar.gz"):
        return "portable"
    return "other"


def _asset_platform(name: str) -> Optional[str]:
    lowered = name.lower()
    for platform in ("windows", "linux", "macos"):
        if platform in lowered:
            return platform
    return None


def _asset_arch(name: str) -> Optional[str]:
    lowered = name.lower()
    for arch in ("x64", "arm64"):
        if arch in lowered:
            return arch
    return None


def _asset_from_github(raw: dict[str, Any]) -> UpdateAsset:
    name = str(raw.get("name") or "")
    return UpdateAsset(
        name=name,
        browser_download_url=str(raw.get("browser_download_url") or ""),
        size=raw.get("size"),
        kind=_asset_kind(name),
        platform=_asset_platform(name),
        arch=_asset_arch(name),
    )


def _recommended_asset(
    assets: list[UpdateAsset], platform: str, arch: str
) -> Optional[UpdateAsset]:
    scored: list[tuple[int, UpdateAsset]] = []
    for asset in assets:
        if asset.kind == "manifest":
            continue
        if asset.platform != platform:
            continue

        score = 50
        if asset.arch == arch:
            score += 25
        if platform == "windows" and asset.kind == "installer":
            score += 15
        elif asset.kind == "portable":
            score += 10
        scored.append((score, asset))

    if not scored:
        return None
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


async def check_for_updates() -> UpdateCheckResponse:
    platform = current_platform()
    arch = current_arch()
    current = normalized_version(APP_VERSION)

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            _GITHUB_LATEST_RELEASE_URL,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"Gabada/{current}",
            },
        )
        response.raise_for_status()
        payload = response.json()

    latest = normalized_version(
        str(payload.get("tag_name") or payload.get("name") or "")
    )
    assets = [_asset_from_github(item) for item in payload.get("assets", [])]
    recommended = _recommended_asset(assets, platform, arch)

    return UpdateCheckResponse(
        current_version=current,
        latest_version=latest or None,
        update_available=bool(latest and is_newer_version(latest, current)),
        release_url=payload.get("html_url"),
        release_name=payload.get("name"),
        published_at=payload.get("published_at"),
        install_mode="desktop" if is_frozen() else "source",
        platform=platform,
        arch=arch,
        recommended_asset=recommended,
        assets=assets,
    )


def update_check_error(message: str) -> UpdateCheckResponse:
    return UpdateCheckResponse(
        current_version=normalized_version(APP_VERSION),
        install_mode="desktop" if is_frozen() else "source",
        platform=current_platform(),
        arch=current_arch(),
        error=message,
    )

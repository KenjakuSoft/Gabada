from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database.models import UpdateAsset  # noqa: E402
from services.update_checker import (  # noqa: E402
    _recommended_asset,
    is_newer_version,
    version_parts,
)


def test_version_compare_handles_multi_digit_parts() -> None:
    assert version_parts("v0.3.10") == (0, 3, 10)
    assert is_newer_version("0.3.10", "0.3.9")
    assert not is_newer_version("0.3.1", "0.3.1")


def test_windows_recommendation_prefers_installer() -> None:
    assets = [
        UpdateAsset(
            name="Gabada-v0.4.0-windows-x64.zip",
            browser_download_url="https://example.test/portable.zip",
            kind="portable",
            platform="windows",
            arch="x64",
        ),
        UpdateAsset(
            name="GabadaSetup-v0.4.0-windows-x64.exe",
            browser_download_url="https://example.test/setup.exe",
            kind="installer",
            platform="windows",
            arch="x64",
        ),
    ]

    assert _recommended_asset(assets, "windows", "x64") == assets[1]

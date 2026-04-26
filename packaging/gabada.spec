# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

from playwright._impl.__pyinstaller import get_hook_dirs
from PyInstaller.utils.hooks import collect_submodules


project_root = Path(SPEC).resolve().parents[1]
entry_script = project_root / "backend" / "desktop_launcher.py"
bundled_sites = project_root / "backend" / "scraper" / "sites.toml"
frontend_dist = project_root / "frontend-web" / "dist"
playwright_browsers = project_root / ".cache" / "playwright-browsers"

if sys.platform == "win32":
    icon_candidate = project_root / "packaging" / "windows" / "assets" / "gabada.ico"
elif sys.platform == "darwin":
    icon_candidate = project_root / "packaging" / "macos" / "assets" / "gabada.icns"
else:
    icon_candidate = project_root / "packaging" / "linux" / "assets" / "gabada.png"

icon_path = icon_candidate if icon_candidate.exists() else None

datas = [
    (str(frontend_dist), "frontend-web/dist"),
    (str(bundled_sites), "backend/scraper"),
]
if playwright_browsers.exists():
    datas.append((str(playwright_browsers), "ms-playwright"))

hiddenimports = collect_submodules("playwright")

a = Analysis(
    [str(entry_script)],
    pathex=[str(project_root / "backend")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=get_hook_dirs(),
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Gabada",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    icon=str(icon_path) if icon_path else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="Gabada",
)

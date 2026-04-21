# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from playwright._impl.__pyinstaller import get_hook_dirs
from PyInstaller.utils.hooks import collect_submodules


project_root = Path(SPEC).resolve().parents[2]
entry_script = project_root / "backend" / "desktop_launcher.py"
bundled_sites = project_root / "backend" / "scraper" / "sites.toml"
frontend_dist = project_root / "frontend-web" / "dist"
playwright_browsers = project_root / ".cache" / "playwright-browsers"

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

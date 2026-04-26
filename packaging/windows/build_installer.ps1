param(
    [switch]$SkipFrontendBuild,
    [switch]$SkipInstaller,
    [string]$AppVersion
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$Python = Join-Path $Root "backend\.venv\Scripts\python.exe"
$FrontendDir = Join-Path $Root "frontend-web"
$SpecPath = Join-Path $Root "packaging\gabada.spec"
$RequirementsPath = Join-Path $ScriptDir "requirements.txt"
$BuildDir = Join-Path $ScriptDir "build"
$DistDir = Join-Path $ScriptDir "dist"
$OutputDir = Join-Path $ScriptDir "output"
$BrowserCacheDir = Join-Path $Root ".cache\playwright-browsers"
$InstallerScript = Join-Path $ScriptDir "gabada.iss"

if (!(Test-Path $Python)) {
    throw "Backend virtual environment not found at $Python"
}

if (!(Test-Path $SpecPath)) {
    throw "Missing PyInstaller spec: $SpecPath"
}

if (!(Test-Path $RequirementsPath)) {
    throw "Missing packaging requirements: $RequirementsPath"
}

Write-Host "Installing packaging requirements..."
& $Python -m pip install -r $RequirementsPath

if (-not $SkipFrontendBuild) {
    Write-Host "Building frontend..."
    Push-Location $FrontendDir
    try {
        npm.cmd run build
    }
    finally {
        Pop-Location
    }
}

Write-Host "Preparing Playwright browser bundle..."
New-Item -ItemType Directory -Force -Path $BrowserCacheDir | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowserCacheDir
& $Python -m playwright install chromium

Write-Host "Building desktop app with PyInstaller..."
if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

& $Python -m PyInstaller `
    --noconfirm `
    --clean `
    --distpath $DistDir `
    --workpath $BuildDir `
    $SpecPath

if ($SkipInstaller) {
    Write-Host "PyInstaller build completed at $DistDir\Gabada"
    exit 0
}

$InnoCandidates = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)
$ISCC = $InnoCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ISCC) {
    Write-Warning "Inno Setup 6 was not found. The app build is ready at $DistDir\Gabada"
    Write-Warning "Install Inno Setup to produce GabadaSetup.exe automatically."
    exit 0
}

Write-Host "Creating installer..."
$ISCCArgs = @(
    "/DSourceDir=$DistDir\Gabada",
    "/DOutputDir=$OutputDir"
)

if ($AppVersion) {
    $ISCCArgs += "/DMyAppVersion=$AppVersion"
}

$ISCCArgs += $InstallerScript

& $ISCC @ISCCArgs

Write-Host "Installer created in $OutputDir"

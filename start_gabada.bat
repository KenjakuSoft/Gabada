@echo off
setlocal
title Gabada Launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND_DIR=%ROOT%\backend"
set "VENV_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "LAUNCHER=%BACKEND_DIR%\desktop_launcher.py"
set "LOG_PATH=%BACKEND_DIR%\logs\gabada.log"

if not exist "%BACKEND_DIR%" (
    echo Backend folder not found:
    echo   %BACKEND_DIR%
    pause
    exit /b 1
)

if not exist "%VENV_PYTHON%" (
    echo Project virtual environment not found:
    echo   %VENV_PYTHON%
    echo.
    echo Create it first, then run this launcher again.
    echo Example:
    echo   cd /d "%BACKEND_DIR%"
    echo   py -3.14 -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist "%LAUNCHER%" (
    echo Desktop launcher not found:
    echo   %LAUNCHER%
    pause
    exit /b 1
)

echo Starting Gabada...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$python = [System.IO.Path]::GetFullPath('%VENV_PYTHON%');" ^
  "$launcher = [System.IO.Path]::GetFullPath('%LAUNCHER%');" ^
  "$backendDir = [System.IO.Path]::GetFullPath('%BACKEND_DIR%');" ^
  "Start-Process -FilePath $python -ArgumentList $launcher -WorkingDirectory $backendDir -WindowStyle Hidden | Out-Null;" ^
  "$deadline = (Get-Date).AddSeconds(25);" ^
  "function Test-Gabada($port) {" ^
  "  try {" ^
  "    $response = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/health') -TimeoutSec 2;" ^
  "    return $response.status -eq 'ok';" ^
  "  } catch {" ^
  "    return $false;" ^
  "  }" ^
  "}" ^
  "while ((Get-Date) -lt $deadline) {" ^
  "  foreach ($port in 8000..8010) {" ^
  "    if (Test-Gabada $port) { exit 0 }" ^
  "  }" ^
  "  Start-Sleep -Milliseconds 500;" ^
  "}" ^
  "exit 2"

if errorlevel 1 (
    echo.
    echo GABADA FAILED TO START.
    if exist "%LOG_PATH%" (
        echo Last log lines:
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "Get-Content -Path '%LOG_PATH%' | Select-Object -Last 40"
    ) else (
        echo No log file found yet at:
        echo   %LOG_PATH%
    )
    pause
    exit /b 1
)

exit /b 0

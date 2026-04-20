@echo off
setlocal
title Gabada Launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND_DIR=%ROOT%\backend"
set "VENV_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "HEALTH_URL=http://127.0.0.1:8000/health"
set "APP_URL=http://127.0.0.1:8000/"

if not exist "%BACKEND_DIR%" (
    echo Backend folder not found:
    echo   %BACKEND_DIR%
    pause
    exit /b 1
)

call :check_health
if defined READY (
    echo Gabada is already running.
    start "" "%APP_URL%"
    exit /b 0
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

echo Starting Gabada backend...
start "Gabada Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && ""%VENV_PYTHON%"" -m uvicorn main:app --port 8000 || (echo. && echo BACKEND CRASHED - see error above && pause)"

echo Waiting for server to initialize...
for /l %%I in (1,1,20) do (
    call :check_health
    if defined READY (
        goto :server_ready
    )
    timeout /t 1 /nobreak >nul
)

:server_ready
if defined READY (
    echo Opening UI in browser...
    start "" "%APP_URL%"
) else (
    echo Backend did not become ready in time.
    echo A backend console window should be open with the error details.
)

exit /b 0

:check_health
set "READY="
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 set "READY=1"
exit /b 0

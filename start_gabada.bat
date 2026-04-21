@echo off
setlocal
title Gabada Launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND_DIR=%ROOT%\backend"
set "VENV_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "LAUNCHER=%BACKEND_DIR%\desktop_launcher.py"

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
start "Gabada" cmd /c "cd /d ""%BACKEND_DIR%"" && ""%VENV_PYTHON%"" ""%LAUNCHER%"" || (echo. && echo GABADA CRASHED - see error above && pause)"
exit /b 0

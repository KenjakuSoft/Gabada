@echo off
title Gabada Launcher

rem Add Python to PATH for this session
set "PATH=%LOCALAPPDATA%\Python\bin;%LOCALAPPDATA%\Python\pythoncore-3.14-64\Scripts;%PATH%"

echo Starting Gabada backend...
start "Gabada Backend" cmd /k "cd /d "%~dp0backend" && python -m uvicorn main:app --port 8000 || (echo. && echo BACKEND CRASHED - see error above && pause)"

echo Waiting for backend to initialize...
timeout /t 4 /nobreak >nul

echo Starting Gabada frontend (debug)...
start "Gabada Frontend" cmd /k "cd /d "%~dp0frontend" && flutter run -d windows"

echo Both services launched. Close this window or press any key.
pause >nul

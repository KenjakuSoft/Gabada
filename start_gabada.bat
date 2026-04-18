@echo off
title Gabada Launcher

rem Add Python to PATH for this session
set "PATH=%LOCALAPPDATA%\Python\bin;%LOCALAPPDATA%\Python\pythoncore-3.14-64\Scripts;%PATH%"

echo Starting Gabada...
start "Gabada" cmd /k "cd /d "%~dp0backend" && python -m uvicorn main:app --port 8000 || (echo. && echo BACKEND CRASHED - see error above && pause)"

echo Waiting for server to initialize...
timeout /t 3 /nobreak >nul

echo Opening UI in browser...
start "" "http://localhost:8000/"

echo Gabada is running at http://localhost:8000/. Close this window or press any key.
pause >nul

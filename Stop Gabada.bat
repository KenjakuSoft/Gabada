@echo off
setlocal
title Stop Gabada

echo Stopping Gabada...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targets = @(Get-CimInstance Win32_Process ^| Where-Object {" ^
  "  ($_.Name -ieq 'python.exe' -and $_.CommandLine -like '*desktop_launcher.py*') -or" ^
  "  ($_.Name -ieq 'Gabada.exe')" ^
  "});" ^
  "if (-not $targets.Count) { exit 3 }" ^
  "$targets ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop };" ^
  "exit 0"

if errorlevel 3 (
    echo Gabada is not running.
    exit /b 0
)

if errorlevel 1 (
    echo Could not stop Gabada automatically.
    echo Try closing it from Task Manager or use the Settings ^> Exit Gabada button.
    pause
    exit /b 1
)

echo Gabada stopped.
exit /b 0

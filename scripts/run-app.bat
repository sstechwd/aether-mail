@echo off
REM Launch the built Aether Mail desktop app.
REM No terminal windows, no browser tab, no dev servers — this is the real app.
REM
REM If it says the app is missing, build it first:  scripts\build-app.bat

cd /d "%~dp0\.."

if not exist "target\release\aether-desktop.exe" (
  echo.
  echo   Aether Mail has not been built yet.
  echo   Run this first ^(takes a few minutes^):
  echo.
  echo       scripts\build-app.bat
  echo.
  pause
  exit /b 1
)

echo Starting Aether Mail...
REM /b avoids a stray console window; the app detaches from this script,
REM so closing this window will not take the app down with it.
start "" /b "target\release\aether-desktop.exe"
exit /b 0

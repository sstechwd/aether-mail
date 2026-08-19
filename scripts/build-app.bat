@echo off
REM Build the Aether Mail desktop app + Windows installer from source.
REM Takes a few minutes the first time (Rust compiles the whole Tauri stack).
REM
REM Produces:
REM   target\release\aether-desktop.exe                          <- run it directly
REM   target\release\bundle\nsis\Aether Mail_*_x64-setup.exe      <- installer

cd /d "%~dp0\.."

REM Rust lives in %USERPROFILE%\.cargo\bin and is not always on PATH.
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where cargo >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Rust is not installed or not on PATH.
  echo   Get it from https://rustup.rs then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo [1/4] Building mail engine ^(aether-cli^)...
cargo build --release -p aether-cli || goto :failed

echo.
echo [2/4] Building API sidecar...
call npm run sidecar:build || goto :failed

echo.
echo [3/4] Checking for the Tauri CLI...
cargo tauri --version >nul 2>&1
if errorlevel 1 (
  echo       Not found. Installing it once ^(this takes a few minutes^)...
  cargo install tauri-cli --version "^2" --locked || goto :failed
)

echo.
echo [4/4] Building the app and installer...
cargo tauri build --config apps/desktop/tauri.conf.json || goto :failed

echo.
echo ============================================================
echo   Done.
echo.
echo   Run it:       scripts\run-app.bat
echo   Installer:    target\release\bundle\nsis\
echo ============================================================
echo.
pause
exit /b 0

:failed
echo.
echo   BUILD FAILED — see the error above.
echo.
pause
exit /b 1

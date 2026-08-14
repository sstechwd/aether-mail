@echo off
cd /d "%~dp0\.."
start "aether-api" cmd /k npm run start -w @aether/api
timeout /t 2 /nobreak >nul
start "aether-web" cmd /k npm run dev -w @aether/web
timeout /t 2 /nobreak >nul
start http://127.0.0.1:5173/
echo Aether Mail: http://127.0.0.1:5173/
echo Close the two extra windows to stop it.

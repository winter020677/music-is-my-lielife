@echo off
rem ============================================================
rem  TikTok LIVE Tool - setup
rem  First time, and after every update: double-click this file.
rem  (Messages from the Node.js scripts below are in Japanese.)
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js is not installed.
  echo Please install the "LTS" version from https://nodejs.org/ and run setup.bat again.
  echo.
  pause
  exit /b 1
)

node tools\check-node.mjs
if errorlevel 1 goto :failed

node tools\stop-running-app.mjs
if errorlevel 1 goto :failed

echo.
echo Installing packages... (this can take a few minutes)
call npm ci --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo Building the admin screen...
call npm run build
if errorlevel 1 goto :failed

node tools\setup-finish.mjs
if errorlevel 1 goto :failed

echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] Setup did not finish. Please show this window to Claude Code.
echo.
pause
exit /b 1

@echo off
rem ============================================================
rem  TikTok LIVE Tool - update
rem  Gets the newest version from GitHub, then runs setup.bat.
rem ============================================================
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Git is not installed. Please install it from https://git-scm.com/ and try again.
  echo.
  pause
  exit /b 1
)

node tools\stop-running-app.mjs
if errorlevel 1 goto :failed

git pull --ff-only
if errorlevel 1 goto :failed

call setup.bat
exit /b %errorlevel%

:failed
echo.
echo [ERROR] Update did not finish. Please show this window to Claude Code.
echo.
pause
exit /b 1

@echo off
REM ============================================================================
REM  Addiction Recovery for YouTube - start
REM  Opens a dedicated Chrome with the extension already loaded and active.
REM  (Regular Chrome no longer loads unpacked extensions from the command line,
REM   so this uses the "Chrome for Testing" browser that npm install downloads.
REM   Its profile lives in .yt-budget-profile\ - sign in to YouTube once and it
REM   is remembered. To use your MAIN Chrome instead, load dist\ once by hand:
REM   chrome://extensions -> Developer mode -> Load unpacked -> pick the dist folder.)
REM ============================================================================
setlocal
cd /d "%~dp0"

REM --- build the extension so the latest code is live (needs Node/npm) ---
where npm >nul 2>nul
if not errorlevel 1 (
  echo Building the extension...
  call npm run build
)
if not exist "dist\manifest.json" (
  echo.
  echo ERROR: dist\manifest.json not found and the build did not run.
  echo Install Node.js from https://nodejs.org, then run:  npm install
  echo.
  pause
  exit /b 1
)

REM --- locate Chrome for Testing (downloaded by npm install / puppeteer) ---
set "CFT="
for /d %%D in ("%USERPROFILE%\.cache\puppeteer\chrome\win64-*") do set "CFT=%%D\chrome-win64\chrome.exe"
if not exist "%CFT%" (
  echo.
  echo ERROR: Chrome for Testing was not found.
  echo Run this once to download it:   npm install
  echo.
  pause
  exit /b 1
)

REM --- close a running dedicated browser first: a new window joining an old
REM     process would keep running the old extension code ---
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*yt-budget-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Starting the dedicated browser...
start "" "%CFT%" --user-data-dir="%~dp0.yt-budget-profile" --load-extension="%~dp0dist" --no-first-run --no-default-browser-check "https://www.youtube.com/"
exit /b 0

@echo off
REM ===============================================
REM  MIS Ticketing System - Windows start script
REM ===============================================
cd /d "%~dp0"

REM If node_modules is missing, run npm install
if not exist "node_modules" (
  echo Installing dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Please install Node.js 18+ from https://nodejs.org first.
    pause
    exit /b 1
  )
)

REM If the database doesn't exist yet, initialize it
if not exist "data\app.db" (
  echo Initializing database...
  call npm run init-db
)

echo.
echo Starting MIS Ticketing System...
echo Press Ctrl+C to stop.
echo.
node src\server.js

pause

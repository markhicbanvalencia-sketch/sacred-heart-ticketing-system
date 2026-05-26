@echo off
setlocal
cd /d "%~dp0\.."

:: Check if server is already running on port 3000
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo Server already running. Opening browser...
    start "" "http://localhost:3000"
    exit /b 0
)

:: Create data folder if it doesn't exist
if not exist "data" mkdir data

:: Start server silently in background
wscript.exe "%~dp0start-silent.vbs"

:: Wait for server to start (up to 10 seconds)
echo Starting Sacred Heart MIS server...
set /a tries=0
:waitloop
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 goto started
set /a tries+=1
if %tries% lss 10 goto waitloop

:started
echo Server started. Opening browser...
start "" "http://localhost:3000"
endlocal

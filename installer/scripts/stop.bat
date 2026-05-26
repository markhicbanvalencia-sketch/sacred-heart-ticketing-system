@echo off
echo Stopping Sacred Heart MIS server...

:: Find and kill the process listening on port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo Server stopped (PID %%a).
    goto done
)
echo No server was running on port 3000.

:done
timeout /t 2 /nobreak >nul

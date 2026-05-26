@echo off
:: Restart loop — exit code 0 means "restart for update", anything else means stop
cd /d "%~dp0\.."

:loop
node src\server.js >> data\server.log 2>&1
if %errorlevel% equ 0 (
    echo [%date% %time%] Restarting server after update... >> data\server.log
    goto loop
)
echo [%date% %time%] Server stopped (exit code %errorlevel%) >> data\server.log

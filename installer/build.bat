@echo off
title Building Sacred Heart MIS Installer v1.0
echo.
echo  ================================================
echo   Sacred Heart MIS - Installer Builder v1.0
echo   MV Tech I.T and Home Automation Services
echo  ================================================
echo.

:: Locate Inno Setup 6 compiler
set ISCC=
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "C:\Program Files\Inno Setup 6\ISCC.exe"       set ISCC="C:\Program Files\Inno Setup 6\ISCC.exe"

if "%ISCC%"=="" (
    echo [ERROR] Inno Setup 6 not found.
    echo.
    echo  Please download and install it from:
    echo    https://jrsoftware.org/isdl.php
    echo.
    echo  Then run this script again.
    echo.
    pause
    exit /b 1
)

:: Create output folder
if not exist "dist" mkdir dist

echo [1/2] Compiling installer...
echo.
%ISCC% /Q setup.iss

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed. Check the output above for details.
    pause
    exit /b 1
)

echo.
echo [2/2] Done!
echo.
echo  Installer created:
echo    %~dp0dist\SacredHeartMIS-v1.0-Setup.exe
echo.
echo  You can now distribute this file to install Sacred Heart MIS
echo  on any Windows computer that has Node.js 18+ installed.
echo.
pause

@echo off
title O'Brien360 - CBECC Result Tool
cd /d "%~dp0"

echo ===================================================
echo   O'Brien360 - CBECC Result Tool
echo   CBECC Result Tool
echo ===================================================
echo.

:: Check for python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.8+ from https://www.python.org/downloads/
    echo and make sure to check "Add python.exe to PATH".
    echo.
    pause
    exit /b 1
)

:: Run the server
echo Starting local server and opening web app...
python server.py

pause

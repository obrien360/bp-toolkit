@echo off
title O'Brien360 - Bluebeam PDF to DWG Converter
cd /d "%~dp0"

echo ===================================================
echo   O'Brien360 - Bluebeam PDF to DWG Converter
echo   Clean Architectural Geometry Engine
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
echo Starting local CAD tool server and opening web app...
python server.py

pause

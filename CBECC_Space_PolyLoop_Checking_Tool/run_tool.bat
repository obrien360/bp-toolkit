@echo off
title O'Brien360 - CBECC Space PolyLoop Checking Tool
cd /d "%~dp0"

echo ===================================================
echo   O'Brien360 - CBECC Space PolyLoop Checking Tool
echo   Space PolyLoop Validation and Geometry Repair
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
echo Starting local PolyLoop Checking Tool server on port 8090...
python server.py

pause

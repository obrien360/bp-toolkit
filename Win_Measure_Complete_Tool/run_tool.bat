@echo off
title O'Brien360 - PDF Window Measurement Completion Tool
cd /d "%~dp0"

echo ===================================================
echo   O'Brien360 - PDF Window Measurement Completion
echo   Architectural Elevation Markup Engine
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

:: Free port 8088 if already in use by an older instance
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8088 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Run the server
echo Starting local Window Measurement server on port 8088...
python server.py 8088

pause

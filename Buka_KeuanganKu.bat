@echo off
setlocal
title Membuka KeuanganKu (Google Chrome)...
cd /d "%~dp0"

set "HTML_PATH=%CD%\index.html"
set "URL=file:///%HTML_PATH:\=/%"

echo ===================================================
echo   Membuka Aplikasi KeuanganKu dengan Google Chrome 
echo ===================================================

REM 1. Cek Google Chrome di Program Files
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="%URL%" --window-size=1200,800
    exit /b 0
)

REM 2. Cek Google Chrome di Program Files (x86)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app="%URL%" --window-size=1200,800
    exit /b 0
)

REM 3. Cek Google Chrome di LocalAppData
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --app="%URL%" --window-size=1200,800
    exit /b 0
)

REM 4. Cek via command 'chrome' di PATH
where chrome >nul 2>&1
if %ERRORLEVEL% equ 0 (
    start chrome --app="%URL%" --window-size=1200,800
    exit /b 0
)

REM 5. Jika Chrome tidak ditemukan, buka browser default
start "" "%HTML_PATH%"
exit /b 0

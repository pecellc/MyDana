@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Memasang Shortcut KeuanganKu di Desktop...
cd /d "%~dp0"

echo ========================================================
echo        MEMASANG SHORTCUT KEUANGANKU DI DESKTOP          
echo ========================================================
echo.

set "TARGET_BAT=%CD%\Buka_KeuanganKu.bat"
set "WORKING_DIR=%CD%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "if (-not (Test-Path $desktop)) { " ^
  "  $oneDriveDesktop = Join-Path $env:USERPROFILE 'OneDrive\Desktop'; " ^
  "  if (Test-Path $oneDriveDesktop) { $desktop = $oneDriveDesktop } " ^
  "  else { $desktop = Join-Path $env:USERPROFILE 'Desktop' } " ^
  "}; " ^
  "$shortcutPath = Join-Path $desktop 'KeuanganKu.lnk'; " ^
  "$shortcut = $ws.CreateShortcut($shortcutPath); " ^
  "$shortcut.TargetPath = '%TARGET_BAT%'; " ^
  "$shortcut.WorkingDirectory = '%WORKING_DIR%'; " ^
  "$shortcut.Description = 'Aplikasi Pencatat & Pengatur Keuangan Pribadi'; " ^
  "$shortcut.IconLocation = 'shell32.dll,260'; " ^
  "$shortcut.Save(); " ^
  "Write-Host '==> Shortcut KeuanganKu berhasil dibuat di: ' -NoNewline -ForegroundColor Green; " ^
  "Write-Host $shortcutPath -ForegroundColor Yellow;"

echo.
echo ========================================================
echo SELESAI!
echo Silakan cek layar Desktop kamu, sekarang sudah ada icon
echo shortcut 'KeuanganKu'. Dobel-klik shortcut itu kapan saja
echo untuk membuka aplikasi!
echo ========================================================
echo.
pause

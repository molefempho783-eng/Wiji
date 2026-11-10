@echo off
rem Double-click this file to start the Android emulator and run Wiji.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-android.ps1" %*
echo.
echo Finished. If something went wrong, the details are in emulator-log.txt
pause

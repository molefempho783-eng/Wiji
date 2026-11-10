@echo off
rem Double-click this WHILE the emulator or app is frozen.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-android.ps1"
pause

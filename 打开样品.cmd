@echo off
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%~dp0open-preview.mjs"
) else (
  node "%~dp0open-preview.mjs"
)
if errorlevel 1 pause

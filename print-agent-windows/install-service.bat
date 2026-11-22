@echo off
chcp 65001 >nul
echo ========================================================
echo   Gatan POS Print Agent Installer (Windows 10 + Sewoo 100)
echo ========================================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed on this computer!
  echo Please install Node.js LTS from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "%~dp0config.json" (
  echo [ERROR] config.json not found in %~dp0
  echo Please copy config.example.json to config.json and set serverUrl and apiKey.
  pause
  exit /b 1
)

echo Detected Windows Printers:
node "%~dp0agent.mjs" --list-printers
echo.

echo Creating hidden launcher (start-hidden.vbs)...
(
  echo Set WshShell = CreateObject("WScript.Shell"^)
  echo WshShell.CurrentDirectory = "%~dp0"
  echo WshShell.Run "node ""%~dp0agent.mjs""", 0, False
) > "%~dp0start-hidden.vbs"

echo Registering Windows auto-start Scheduled Task (GatanPrintAgent)...
schtasks /Delete /TN "GatanPrintAgent" /F >nul 2>nul
schtasks /Create /TN "GatanPrintAgent" /TR "wscript.exe \"%~dp0start-hidden.vbs\"" /SC ONLOGON /RL HIGHEST /F

if errorlevel 1 (
  echo [WARN] Could not register with HIGHEST privileges, retrying with standard user privileges...
  schtasks /Create /TN "GatanPrintAgent" /TR "wscript.exe \"%~dp0start-hidden.vbs\"" /SC ONLOGON /F
)

echo Starting Gatan Print Agent now in background...
start "" wscript.exe "%~dp0start-hidden.vbs"

echo.
echo [SUCCESS] Gatan Print Agent is installed and running!
echo Check the ERP Print Queue modal: status should turn GREEN (Online) within 10 seconds.
echo Logs are written to: %~dp0agent.log
echo.
pause

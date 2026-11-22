@echo off
chcp 65001 >nul
echo Removing GatanPrintAgent scheduled task...
schtasks /Delete /TN "GatanPrintAgent" /F >nul 2>nul
echo Stopping running node agent processes (if any)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*agent.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Done. Gatan Print Agent has been uninstalled.
pause

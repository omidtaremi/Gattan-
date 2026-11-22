@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Printing local 72mm test receipt to Sewoo 100...
node "%~dp0agent.mjs" --test
pause

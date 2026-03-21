@echo off
title Ireland Lead Miner
cd /d "C:\Users\Win10\CLAUDE PROJETOS\minerador-leads"

echo.
echo  Verificando Playwright...
npx playwright install chromium --quiet 2>nul
echo  OK!
echo.

node ireland\minerar-ireland.js
pause

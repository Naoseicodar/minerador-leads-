@echo off
title Minerador Portugal Auto-Restart
cd /d "C:\Users\Win10\CLAUDE PROJETOS\minerador-leads"
:loop
echo Iniciando Minerador Portugal...
node portugal\minerar-portugal.js
echo Minerador finalizado ou ocorreu um erro. Reiniciando em 5 segundos...
timeout /t 5
goto loop

@echo off
cd /d "C:\Users\Win10\CLAUDE PROJETOS\minerador-leads"
node br\claudio-insta.js
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Pressione qualquer tecla para fechar...
  pause >nul
)

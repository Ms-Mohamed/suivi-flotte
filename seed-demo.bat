@echo off
setlocal
cd /d "%~dp0"
echo ATTENTION : cette commande EFFACE toutes les donnees et les remplace par des donnees fictives de demonstration.
set /p OK=Tapez OUI pour continuer : 
if /i not "%OK%"=="OUI" exit /b 0
docker compose exec app node server/src/seedDemo.js
pause

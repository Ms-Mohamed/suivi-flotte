@echo off
setlocal
cd /d "%~dp0"
echo === Suivi Flotte : demarrage avec Docker ===
docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo Docker Desktop n'est pas demarre. Lancez Docker Desktop, attendez qu'il soit pret, puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist ".env" (
  echo.
  echo Premier demarrage : creation du fichier .env avec un mot de passe aleatoire...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\init-env.ps1"
  if errorlevel 1 (
    echo Impossible de creer .env
    pause
    exit /b 1
  )
)
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Echec du demarrage. Consultez les messages ci-dessus.
  pause
  exit /b 1
)
echo.
echo Application prete : http://localhost:4000
start "" http://localhost:4000
pause

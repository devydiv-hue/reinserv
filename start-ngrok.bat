@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo  Reincarnator: starting shared session (via ngrok)
echo ========================================================
echo.
echo Use this instead of start.bat if start.bat's tunnel (cloudflared) does not
echo work on your network - some networks block the specific port cloudflared
echo needs and there is no way around that. ngrok uses the same port as normal
echo HTTPS browsing (443), which is almost never blocked.
echo.
echo This path needs one manual one-time step: a free ngrok account. Nothing
echo else - the link itself still works the same way for players afterwards.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found.
  echo     Download and install it from https://nodejs.org ^(the "LTS" button^), then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ngrok.exe (
  echo Downloading ngrok...
  where curl >nul 2>nul
  if not errorlevel 1 (
    curl -fL --retry 2 -o ngrok.zip "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip"
  )
  if not exist ngrok.zip (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile 'ngrok.zip' -UseBasicParsing"
  )
  if exist ngrok.zip (
    powershell -Command "Expand-Archive -Path 'ngrok.zip' -DestinationPath '.' -Force"
    del ngrok.zip
  )
  if not exist ngrok.exe (
    echo [!] Could not download ngrok automatically - opening the download page in your browser instead.
    echo     Save ngrok.exe into this same folder, then run this file again:
    echo     %~dp0
    start "" "https://ngrok.com/download"
    echo.
    pause
    exit /b 1
  )
)

echo.
echo ---------------------------------------------------------------
echo  ONE-TIME SETUP (skip if you already did this before):
echo   1. Sign up for a free account: https://dashboard.ngrok.com/signup
echo   2. Copy your authtoken from:    https://dashboard.ngrok.com/get-started/your-authtoken
echo   3. Come back here and paste it when asked below.
echo  If you already have an authtoken configured, just press Enter.
echo ---------------------------------------------------------------
set /p NGROK_TOKEN="Paste your authtoken here (or press Enter to skip): "
if not "%NGROK_TOKEN%"=="" (
  ngrok.exe config add-authtoken %NGROK_TOKEN%
)

echo.
echo Starting server...
start "Reincarnator - server" cmd /k node server.js

timeout /t 2 /nobreak >nul

echo Starting tunnel for players outside your network...
echo (a link like https://something.ngrok-free.app will appear in the new window in a few seconds)
start "Reincarnator - link for players" cmd /k ngrok.exe http 3000

echo.
echo Done. Keep the new windows open while you play.
echo Same room/Wi-Fi: http://localhost:3000 (or your local IP instead of localhost)
echo Players over the internet: the "Forwarding" link shown in the ngrok window
echo (looks like https://xxxx.ngrok-free.app)
pause

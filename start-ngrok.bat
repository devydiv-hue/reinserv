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
echo The ngrok authtoken is taken from ngrok-authtoken.txt - no questions asked.
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
rem Authtoken is read from ngrok-authtoken.txt next to this file (kept out of git, see .gitignore),
rem so the tunnel starts without any questions. Without that file ngrok uses its saved config.
if exist ngrok-authtoken.txt (
  set /p NGROK_TOKEN=<ngrok-authtoken.txt
)
if not "%NGROK_TOKEN%"=="" (
  ngrok.exe config add-authtoken %NGROK_TOKEN% >nul
) else (
  echo [i] ngrok-authtoken.txt not found - using the authtoken already saved in ngrok config.
  echo     If ngrok says "authentication failed", put your token from
  echo     https://dashboard.ngrok.com/get-started/your-authtoken into ngrok-authtoken.txt
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

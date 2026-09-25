@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo  Reincarnator: starting shared session
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found.
  echo     Download and install it from https://nodejs.org ^(the "LTS" button^), then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist cloudflared.exe (
  echo Downloading cloudflared ^(free tunnel for players outside your network^)...

  rem In case a previous run already downloaded it to the browser's default Downloads folder
  rem (see the manual fallback further down) - pick it up automatically instead of asking again.
  if exist "%USERPROFILE%\Downloads\cloudflared-windows-amd64.exe" (
    copy /y "%USERPROFILE%\Downloads\cloudflared-windows-amd64.exe" "cloudflared.exe" >nul
  )

  if not exist cloudflared.exe (
    where curl >nul 2>nul
    if not errorlevel 1 (
      curl -fL --retry 2 -o cloudflared.exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    )
  )
  rem a real cloudflared.exe is tens of MB - anything smaller means the download broke partway
  rem through and left a useless leftover file that would otherwise pass an "if exist" check.
  if exist cloudflared.exe (
    for %%A in (cloudflared.exe) do if %%~zA LSS 1000000 del cloudflared.exe
  )

  if not exist cloudflared.exe (
    rem curl missing or failed - fall back to PowerShell, forcing TLS 1.2. Older Windows PowerShell
    rem does not enable TLS 1.2 by default, and GitHub's download servers require it - that is the
    rem "underlying connection was closed" error this line works around.
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' -UseBasicParsing"
  )
  if exist cloudflared.exe (
    for %%A in (cloudflared.exe) do if %%~zA LSS 1000000 del cloudflared.exe
  )

  if not exist cloudflared.exe (
    echo [!] Could not download cloudflared automatically - opening the download page in your browser instead.
    echo     Just let it save to your normal Downloads folder - next time you run start.bat it will be
    echo     picked up from there automatically. ^(Or move/rename it yourself to "cloudflared.exe" in:
    echo     %~dp0 ^)
    start "" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    echo.
    echo     If the page does not open or the download does not start either, your network or
    echo     antivirus may be blocking it entirely - the local server below will still work fine
    echo     for players on your own Wi-Fi/network even without the tunnel.
    echo.
    pause
  )
)

echo.
echo Starting server...
start "Reincarnator - server" cmd /k node server.js

timeout /t 2 /nobreak >nul

if exist cloudflared.exe (
  echo Starting tunnel for players outside your network...
  echo ^(a link like https://something.trycloudflare.com will appear in the new window in a few seconds^)
  rem --protocol http2: cloudflared defaults to QUIC (over UDP), which plenty of networks/routers/
  rem antivirus block or throttle - that shows up as endless "failed to dial to edge with quic:
  rem timeout: no recent network activity" retries and no link ever appearing. HTTP/2 runs over
  rem plain TCP instead, which almost nothing blocks, so forcing it here just works out of the box.
  start "Reincarnator - link for players" cmd /k cloudflared.exe tunnel --protocol http2 --url http://localhost:3000
) else (
  echo Tunnel not started ^(cloudflared.exe not found^) - session only works on your local network:
  echo   players on the same Wi-Fi should open http://YOUR-LOCAL-IP:3000
)

echo.
echo Done. Keep the new windows open while you play.
echo Same room/Wi-Fi: http://localhost:3000 ^(or your local IP instead of localhost^)
echo Players over the internet: the link from the "Reincarnator - link for players" window
echo (if that window keeps showing connection errors instead of a link - some networks
echo  block what cloudflared needs and there is no fix for that; try start-ngrok.bat instead)
pause

#!/bin/bash
cd "$(dirname "$0")"
echo "========================================================"
echo " Reincarnator: starting shared session"
echo "========================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js not found."
  echo "    Download and install it from https://nodejs.org (the \"LTS\" button), then run this file again."
  read -p "Press Enter to exit..."
  exit 1
fi

if [ ! -f cloudflared ]; then
  echo "Downloading cloudflared (free tunnel for players outside your network)..."
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  if [ "$OS" = "Darwin" ]; then
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
    curl -fsSL "$URL" -o cloudflared.tgz && tar -xzf cloudflared.tgz && rm cloudflared.tgz
  else
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    else
      URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    fi
    curl -fsSL "$URL" -o cloudflared
  fi
  chmod +x cloudflared 2>/dev/null
  if [ ! -f cloudflared ]; then
    echo "[!] Could not download cloudflared automatically."
    echo "    Download it manually: https://github.com/cloudflare/cloudflared/releases/latest"
    echo "    The local server will still start - it will work for players on your own network."
  fi
fi

echo
echo "Starting server..."
node server.js &
SERVER_PID=$!
sleep 2

if [ -f cloudflared ]; then
  echo "Starting tunnel for players outside your network..."
  echo "(a link like https://something.trycloudflare.com will appear below in a few seconds)"
  # --protocol http2: cloudflared defaults to QUIC (over UDP), which plenty of networks/routers/
  # antivirus block or throttle - that shows up as endless "failed to dial to edge with quic:
  # timeout: no recent network activity" retries and no link ever appearing. HTTP/2 runs over
  # plain TCP instead, which almost nothing blocks, so forcing it here just works out of the box.
  ./cloudflared tunnel --protocol http2 --url http://localhost:3000 &
  TUNNEL_PID=$!
else
  echo "Tunnel not started (cloudflared not found) - session only works on your local network:"
  echo "  players on the same Wi-Fi should open http://YOUR-LOCAL-IP:3000"
fi

echo
echo "Done. Keep this window open while you play."
echo "Same room/Wi-Fi: http://localhost:3000 (or your local IP instead of localhost)"
echo "Players over the internet: the link above starting with https://...trycloudflare.com"
echo "(if that never appears and you only see connection errors above - some networks block"
echo " what cloudflared needs and there is no fix for that; try start-ngrok.sh instead)"
echo "Press Ctrl+C to stop the server and tunnel."
wait $SERVER_PID

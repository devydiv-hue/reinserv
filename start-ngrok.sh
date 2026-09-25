#!/bin/bash
cd "$(dirname "$0")"
echo "========================================================"
echo " Reincarnator: starting shared session (via ngrok)"
echo "========================================================"
echo
echo "Use this instead of start.sh if start.sh's tunnel (cloudflared) does not"
echo "work on your network - some networks block the specific port cloudflared"
echo "needs and there is no way around that. ngrok uses the same port as normal"
echo "HTTPS browsing (443), which is almost never blocked."
echo
echo "This path needs one manual one-time step: a free ngrok account. Nothing"
echo "else - the link itself still works the same way for players afterwards."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js not found."
  echo "    Download and install it from https://nodejs.org (the \"LTS\" button), then run this file again."
  read -p "Press Enter to exit..."
  exit 1
fi

if [ ! -f ngrok ]; then
  echo "Downloading ngrok..."
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  if [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
      URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-arm64.zip"
    else
      URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-amd64.zip"
    fi
    curl -fsSL "$URL" -o ngrok.zip && unzip -o ngrok.zip && rm ngrok.zip
  else
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz"
    else
      URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz"
    fi
    curl -fsSL "$URL" -o ngrok.tgz && tar -xzf ngrok.tgz && rm ngrok.tgz
  fi
  chmod +x ngrok 2>/dev/null
  if [ ! -f ngrok ]; then
    echo "[!] Could not download ngrok automatically."
    echo "    Download it manually: https://ngrok.com/download"
    echo "    Put the extracted 'ngrok' file into this folder, then run this script again."
    read -p "Press Enter to exit..."
    exit 1
  fi
fi

echo
echo "---------------------------------------------------------------"
echo " ONE-TIME SETUP (skip if you already did this before):"
echo "  1. Sign up for a free account: https://dashboard.ngrok.com/signup"
echo "  2. Copy your authtoken from:    https://dashboard.ngrok.com/get-started/your-authtoken"
echo "  3. Come back here and paste it when asked below."
echo " If you already have an authtoken configured, just press Enter."
echo "---------------------------------------------------------------"
read -p "Paste your authtoken here (or press Enter to skip): " NGROK_TOKEN
if [ -n "$NGROK_TOKEN" ]; then
  ./ngrok config add-authtoken "$NGROK_TOKEN"
fi

echo
echo "Starting server..."
node server.js &
SERVER_PID=$!
sleep 2

echo "Starting tunnel for players outside your network..."
echo "(a link like https://something.ngrok-free.app will appear below in a few seconds)"
./ngrok http 3000 &

echo
echo "Done. Keep this window open while you play."
echo "Same room/Wi-Fi: http://localhost:3000 (or your local IP instead of localhost)"
echo "Players over the internet: the \"Forwarding\" link shown above (https://xxxx.ngrok-free.app)"
echo "Press Ctrl+C to stop the server and tunnel."
wait $SERVER_PID

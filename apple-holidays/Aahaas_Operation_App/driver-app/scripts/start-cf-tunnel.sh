#!/usr/bin/env bash
# Dev server for a phone that can't reach this Mac on the LAN: a Cloudflare quick
# tunnel in front of Metro (Expo's own --tunnel uses ngrok, which often times out).
set -euo pipefail
cd "$(dirname "$0")/.."

LOG=$(mktemp)
cloudflared tunnel --url http://localhost:8081 --no-autoupdate >"$LOG" 2>&1 &
CF=$!
trap 'kill $CF 2>/dev/null; rm -f "$LOG"' EXIT

# The URL is printed before the tunnel is connected; a phone that opens it too
# early gets Cloudflare error 1033, so wait for the registered connection too.
URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && grep -q 'Registered tunnel connection' "$LOG" && break
  sleep 1
done
grep -q 'Registered tunnel connection' "$LOG" || { cat "$LOG"; echo "cloudflared did not connect"; exit 1; }

echo "Tunnel ready: $URL"
# Expo Go by default (the phones have it); `npm run start:tunnel -- --dev-client` for the custom build.
EXPO_PACKAGER_PROXY_URL="$URL" npx expo start --port 8081 "${@:---go}"

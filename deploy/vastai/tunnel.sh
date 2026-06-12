#!/bin/bash
# Expose the GXO Loadout site publicly via Cloudflare Tunnel (no open ports on
# the Vast.ai box; the app stays bound to 127.0.0.1).
#
# Two modes:
#   1. Named tunnel (production):
#        CLOUDFLARE_TUNNEL_TOKEN=<token> bash tunnel.sh
#      Get the token from Cloudflare Zero Trust -> Networks -> Tunnels ->
#      Create a tunnel (cloudflared) -> copy the token. The token is persisted
#      to /root/.gxo-tunnel-token so run_services.sh restarts the tunnel after
#      instance reboots. Put Cloudflare Access in front of the hostname — the
#      app itself has NO authentication.
#   2. Quick tunnel (testing only, no account needed):
#        bash tunnel.sh
#      Prints a random https://*.trycloudflare.com URL. Unauthenticated and
#      changes on every restart.
set -e

APP_PORT="${APP_PORT:-8081}"
TOKEN_FILE=/root/.gxo-tunnel-token

if ! command -v cloudflared >/dev/null; then
  echo "==> Installing cloudflared..."
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi

if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  printf '%s' "$CLOUDFLARE_TUNNEL_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

tmux kill-session -t tunnel 2>/dev/null || true

if [ -s "$TOKEN_FILE" ]; then
  echo "==> Starting named Cloudflare tunnel..."
  tmux new-session -d -s tunnel \
    "cloudflared tunnel run --token $(cat $TOKEN_FILE) 2>&1 | tee /var/log/cloudflared.log"
  echo "Tunnel running. The site is served at the public hostname configured in"
  echo "Cloudflare Zero Trust (route it to http://127.0.0.1:$APP_PORT)."
  echo "REMINDER: protect the hostname with a Cloudflare Access policy."
else
  echo "==> No CLOUDFLARE_TUNNEL_TOKEN — starting a TEMPORARY quick tunnel..."
  tmux new-session -d -s tunnel \
    "cloudflared tunnel --url http://127.0.0.1:$APP_PORT 2>&1 | tee /var/log/cloudflared.log"
  echo "Waiting for the public URL..."
  for i in $(seq 1 30); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /var/log/cloudflared.log 2>/dev/null | head -1 || true)
    [ -n "$URL" ] && break
    sleep 2
  done
  if [ -n "$URL" ]; then
    echo
    echo "PUBLIC URL: $URL"
    echo "WARNING: this URL is unauthenticated and changes on restart — testing only."
  else
    echo "Could not detect the URL — check: tmux attach -t tunnel"
  fi
fi

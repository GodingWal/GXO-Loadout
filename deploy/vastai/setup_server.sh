#!/bin/bash
# One-shot setup for running EVERYTHING (Cosmos inference + the GXO Loadout
# web app) on a single Vast.ai GPU server.
#
# Usage (on the Vast.ai box as root):
#   bash setup_server.sh
# or straight from GitHub:
#   curl -fsSL https://raw.githubusercontent.com/GodingWal/GXO-Loadout/main/deploy/vastai/setup_server.sh | bash
#
# Layout:
#   - vLLM serving nvidia/Cosmos-Reason1-7B on localhost:8001 (GPU)
#   - GXO Loadout FastAPI + built frontend on port 8080
# Access the site via the SSH tunnel:  ssh -p <port> root@<ip> -L 8080:localhost:8080
set -e

REPO_URL="${REPO_URL:-https://github.com/GodingWal/GXO-Loadout.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/gxo-loadout}"
APP_PORT="${APP_PORT:-8080}"
VLLM_PORT="${VLLM_PORT:-8001}"
MODEL="${COSMOS_MODEL_NAME:-nvidia/Cosmos-Reason1-7B}"

echo "==> [1/5] Installing system dependencies (git, node, python)..."
apt-get update -qq
apt-get install -y -qq git curl python3-pip python3-venv tmux > /dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null
  apt-get install -y -qq nodejs > /dev/null
fi
echo "    node $(node -v), $(python3 --version)"

echo "==> [2/5] Cloning and building GXO Loadout..."
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
pip3 install -q -r requirements.txt
npm install --silent
npm run build

echo "==> [3/5] Installing vLLM (this can take several minutes)..."
pip3 install -q vllm

echo "==> [4/5] Installing service launcher, restart hook, and nightly backup..."
chmod +x "$APP_DIR/deploy/vastai/run_services.sh" "$APP_DIR/deploy/vastai/backup.sh"
# Vast.ai runs /root/onstart.sh on every instance (re)start
cp "$APP_DIR/deploy/vastai/run_services.sh" /root/onstart.sh
chmod +x /root/onstart.sh
# Nightly backup of the DB + photos at 02:15 (set BACKUP_REMOTE to ship off-box)
( crontab -l 2>/dev/null | grep -v 'deploy/vastai/backup.sh'; \
  echo "15 2 * * * APP_DIR=$APP_DIR bash $APP_DIR/deploy/vastai/backup.sh >> /var/log/gxo-backup.log 2>&1" ) | crontab -

echo "==> [5/5] Starting services (vLLM + app, bound to localhost only)..."
APP_DIR="$APP_DIR" APP_PORT="$APP_PORT" VLLM_PORT="$VLLM_PORT" COSMOS_MODEL_NAME="$MODEL" \
  bash "$APP_DIR/deploy/vastai/run_services.sh"

echo "    Waiting for the model to load (first run downloads ~16GB of weights)..."
for i in $(seq 1 240); do
  if curl -s "http://127.0.0.1:$VLLM_PORT/v1/models" | grep -q "$MODEL"; then
    echo "    vLLM is up."
    break
  fi
  sleep 10
  [ "$i" = 240 ] && { echo "    vLLM did not come up in 40min — check: tmux attach -t cosmos"; exit 1; }
done
sleep 5
curl -s "http://127.0.0.1:$APP_PORT/api/health" | head -c 400 && echo

echo
echo "Done. Site: http://localhost:$APP_PORT (via your SSH tunnel -L $APP_PORT:localhost:$APP_PORT)"
echo "Logs:  tmux attach -t loadout   |   tmux attach -t cosmos"

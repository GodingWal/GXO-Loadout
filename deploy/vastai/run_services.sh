#!/bin/bash
# (Re)starts both services on the Vast.ai box. Installed to /root/onstart.sh by
# setup_server.sh so everything comes back automatically after an instance
# restart. Safe to run manually at any time.
set -e

APP_DIR="${APP_DIR:-/opt/gxo-loadout}"
APP_PORT="${APP_PORT:-8080}"
VLLM_PORT="${VLLM_PORT:-8001}"
MODEL="${COSMOS_MODEL_NAME:-nvidia/Cosmos-Reason1-7B}"
export HF_HOME="${HF_HOME:-/opt/hf-cache}"   # keep model weights out of /tmp

mkdir -p "$HF_HOME" /var/log

tmux kill-session -t cosmos 2>/dev/null || true
tmux new-session -d -s cosmos \
  "HF_HOME='$HF_HOME' python3 -m vllm.entrypoints.openai.api_server \
     --model '$MODEL' --host 127.0.0.1 --port $VLLM_PORT \
     --max-model-len 8192 --gpu-memory-utilization 0.85 \
     2>&1 | tee /var/log/cosmos-vllm.log"

tmux kill-session -t loadout 2>/dev/null || true
tmux new-session -d -s loadout \
  "cd '$APP_DIR' && PORT=$APP_PORT COSMOS_ENDPOINT=http://127.0.0.1:$VLLM_PORT/v1 \
   python3 server.py 2>&1 | tee /var/log/gxo-loadout.log"

echo "Services starting. Logs: tmux attach -t cosmos | tmux attach -t loadout"

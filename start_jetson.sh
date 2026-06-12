#!/bin/bash
# Startup script for GXO Loadout on NVIDIA Jetson Orin (Linux Environment)

echo "============================================================"
echo "Starting GXO Loadout on NVIDIA Jetson Orin"
echo "============================================================"
echo

# Exit on first failure
set -e

echo "[1/3] Installing Python dependencies..."
pip install -r requirements.txt

echo
echo "[2/3] Installing Node packages and building frontend..."
npm install
npm run build

echo
echo "[3/3] Launching Edge Server on port 8000..."
# Point inference at the Vast.ai Cosmos server (see deploy/vastai/README.md):
# export COSMOS_ENDPOINT="http://<vast-ip>:<port>/v1"
# export COSMOS_API_KEY="your-vllm-api-key"
python server.py

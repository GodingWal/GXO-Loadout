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
# To run local GPU-accelerated NVIDIA Cosmos model, pass COSMOS_LOCAL_GPU=true
# export COSMOS_LOCAL_GPU=true
# export NVIDIA_API_KEY="your-api-key"
python server.py

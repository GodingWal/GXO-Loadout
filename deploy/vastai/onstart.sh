#!/bin/bash
# Vast.ai on-start script: serves NVIDIA Cosmos-Reason1-7B via vLLM's
# OpenAI-compatible API for the GXO Loadout edge server.
#
# Use with the vllm/vllm-openai docker image (see README.md). The container's
# entrypoint is overridden, so this script launches the server itself.
set -e

MODEL="${COSMOS_MODEL_NAME:-nvidia/Cosmos-Reason1-7B}"
PORT="${VLLM_PORT:-8000}"
API_KEY="${VLLM_API_KEY:?Set VLLM_API_KEY in the Vast.ai instance environment}"

python3 -m vllm.entrypoints.openai.api_server \
  --model "$MODEL" \
  --port "$PORT" \
  --host 0.0.0.0 \
  --api-key "$API_KEY" \
  --max-model-len 8192 \
  --limit-mm-per-prompt '{"image": 1}' \
  --gpu-memory-utilization 0.92

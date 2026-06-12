# Running Cosmos inference on Vast.ai

The GXO Loadout edge server (`server.py`) no longer runs the model itself. All
vision tasks (bag counting, batch-code OCR, picklist/BOL extraction, damage
assessment) are sent to an OpenAI-compatible endpoint defined by
`COSMOS_ENDPOINT`. This guide provisions that endpoint on a rented Vast.ai GPU
using [vLLM](https://docs.vllm.ai) serving
[`nvidia/Cosmos-Reason1-7B`](https://huggingface.co/nvidia/Cosmos-Reason1-7B).

## 1. Pick hardware

Cosmos-Reason1-7B in fp16/bf16 needs roughly 18–20 GB of VRAM with an 8K
context. Any single GPU with **24 GB+** works well — RTX 3090 / 4090 / A5000 /
L4 are cheap, common choices on Vast.

## 2. Launch the instance

### Option A — web console

1. Template: **vLLM (OpenAI-compatible)** or a plain `vllm/vllm-openai:latest`
   image with the entrypoint blank.
2. On-start script: paste the contents of `onstart.sh` from this directory.
3. Environment variables on the instance:
   - `VLLM_API_KEY` — any long random secret (the edge server sends it as a
     bearer token).
   - Optionally `VLLM_PORT` (default `8000`) and `COSMOS_MODEL_NAME`.
4. Expose/forward the port (`-p 8000:8000` in docker options). Vast maps it to
   a public `IP:PORT` pair shown on the instance card.

### Option B — vastai CLI

```bash
pip install vastai
vastai set api-key <YOUR_VAST_API_KEY>

# Find a 24GB+ GPU offer
vastai search offers 'gpu_ram>=24 num_gpus=1 inet_down>200 reliability>0.98' -o 'dph'

vastai create instance <OFFER_ID> \
  --image vllm/vllm-openai:latest \
  --disk 60 \
  --env '-p 8000:8000 -e VLLM_API_KEY=<YOUR_SECRET>' \
  --onstart-cmd "$(cat deploy/vastai/onstart.sh)"
```

The first boot downloads ~16 GB of model weights; allow 5–10 minutes.

## 3. Verify the server

Get the public IP/port from `vastai show instances` (or the console), then:

```bash
curl -H "Authorization: Bearer <YOUR_SECRET>" http://<vast-ip>:<port>/v1/models
```

You should see `nvidia/Cosmos-Reason1-7B` listed.

## 4. Point the edge server at it

On the machine running GXO Loadout:

```bash
export COSMOS_ENDPOINT="http://<vast-ip>:<port>/v1"
export COSMOS_API_KEY="<YOUR_SECRET>"
# optional overrides:
# export COSMOS_MODEL_NAME="nvidia/Cosmos-Reason1-7B"
# export COSMOS_TIMEOUT_SECONDS=90
```

then start it normally (`./start_jetson.sh` or `docker compose up`). The Admin
panel's health card shows the endpoint and whether it is reachable; when
`COSMOS_ENDPOINT` is unset or unreachable, the server falls back to mock data
so the app remains usable.

# Fine-tuning the vision model on your own documents

Use this when prompt tuning has plateaued. You will need **at least ~100
labeled photos per problem category** (BOL, bag flap, ...) — below that, LoRA
fine-tuning mostly memorizes instead of generalizing. 200–500 is the sweet
spot.

## Workflow

### 1. Collect labeled examples

Every analyzed photo is already saved on the server under
`uploads/<inspectionId>/<photoId>.jpg`. For each photo you want to train on,
create a case directory in the same format the eval harness uses:

    training_data/
      bol_0001/
        photo.jpg
        label.json

`label.json` holds the request params and the FULL correct output for the
category (same shape the model is supposed to return):

```json
{
  "category": "BOL",
  "expected": {
    "loadNumber": "835816263",
    "shipDate": "2026-05-20",
    "carrier": "SS Transportation LLC",
    "numberOfStops": 1,
    "deliveries": [
      {"deliveryNumber": "8045123", "stopNumber": 1,
       "lineItems": [{"batchCode": "P18GY43M8", "productName": "Field Corn 201-40VT4PRIB", "expectedQuantity": 40, "uom": "BAG"}]}
    ]
  }
}
```

Tip: run the photo through the live model first (`scripts/eval.py` or the
app), copy its JSON output, and just CORRECT the wrong fields — much faster
than typing labels from scratch. Wrong model outputs that you corrected are
the most valuable training examples.

### 2. Build the dataset

```bash
python3 training/prepare_dataset.py --data training_data --out training_data/dataset.jsonl
```

This pairs each photo with the same prompt the server uses in production
(imported from `server.py`, so train and inference prompts never drift) and
the corrected JSON as the target. It splits 90/10 into train/val.

### 3. Train (on the Vast.ai GPU)

```bash
pip3 install "transformers>=4.49" peft accelerate qwen-vl-utils
python3 training/train_lora.py --dataset training_data/dataset.jsonl --out lora_out
```

Defaults: LoRA rank 16 on attention+MLP projections, bf16, 3 epochs,
batch 1 × grad-accum 8. A 7B model + LoRA fits comfortably in 48 GB.
**Stop vLLM first** (`tmux kill-session -t cosmos`) to free the GPU.

### 4. Serve the adapter

```bash
LORA_DIR=/opt/gxo-loadout/lora_out bash deploy/vastai/run_services.sh
```

`run_services.sh` passes the adapter to vLLM (`--enable-lora`) and the app
automatically requests the tuned model. Re-run `scripts/eval.py` against your
held-out cases and compare with the base model before trusting it.

## Should you fine-tune at all?

Try these first — each is minutes, not days:

1. **Swap the base model**: `COSMOS_MODEL_NAME=Qwen/Qwen2.5-VL-7B-Instruct`
   — the underlying Qwen2.5-VL is markedly stronger at document OCR than the
   Cosmos physical-reasoning fine-tune. Keep whichever scores better on
   `scripts/eval.py`.
2. **Tighten prompts** with exact layout anchors (where each field sits on
   the page, what format the value has).
3. **Better photos**: fill the frame, square-on, good light.

Fine-tune when a measured eval shows the best prompt+model combination still
isn't accurate enough.

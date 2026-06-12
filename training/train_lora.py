#!/usr/bin/env python3
"""LoRA fine-tuning for the Cosmos / Qwen2.5-VL vision model on labeled
document photos. See training/README.md for the full workflow.

Requires: pip3 install "transformers>=4.49" peft accelerate qwen-vl-utils
Stop vLLM first to free the GPU: tmux kill-session -t cosmos
"""
import argparse
import json
from pathlib import Path

import torch
from PIL import Image
from peft import LoraConfig, get_peft_model
from torch.utils.data import Dataset
from transformers import (
    AutoProcessor,
    Qwen2_5_VLForConditionalGeneration,
    Trainer,
    TrainingArguments,
)

MAX_IMAGE_EDGE = 1280  # keep VRAM in check; matches typical inference input


class JsonlVLMDataset(Dataset):
    def __init__(self, path, split):
        self.rows = [
            json.loads(line)
            for line in Path(path).read_text().splitlines()
            if line.strip() and json.loads(line)["split"] == split
        ]

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        return self.rows[idx]


def make_collator(processor):
    def collate(batch):
        texts, images = [], []
        for row in batch:
            img = Image.open(row["image"]).convert("RGB")
            img.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
            images.append(img)
            messages = [
                {"role": "user", "content": [
                    {"type": "image"},
                    {"type": "text", "text": row["prompt"]},
                ]},
                {"role": "assistant", "content": [{"type": "text", "text": row["target"]}]},
            ]
            texts.append(processor.apply_chat_template(messages, tokenize=False))

        inputs = processor(text=texts, images=images, return_tensors="pt", padding=True)
        labels = inputs["input_ids"].clone()
        labels[labels == processor.tokenizer.pad_token_id] = -100
        # Mask everything before the assistant turn so loss is on the JSON only
        for i, row in enumerate(batch):
            target_ids = processor.tokenizer(row["target"], add_special_tokens=False)["input_ids"]
            seq = labels[i].tolist()
            # find the last occurrence of the target's first tokens
            start = None
            for j in range(len(seq) - len(target_ids), -1, -1):
                if seq[j:j + len(target_ids)] == target_ids:
                    start = j
                    break
            if start is not None:
                labels[i, :start] = -100
        inputs["labels"] = labels
        return inputs

    return collate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="JSONL from prepare_dataset.py")
    ap.add_argument("--model", default="nvidia/Cosmos-Reason1-7B")
    ap.add_argument("--out", default="lora_out")
    ap.add_argument("--epochs", type=float, default=3)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--rank", type=int, default=16)
    args = ap.parse_args()

    processor = AutoProcessor.from_pretrained(args.model)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        args.model, torch_dtype=torch.bfloat16, device_map="auto"
    )
    model.config.use_cache = False

    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank * 2,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    train_ds = JsonlVLMDataset(args.dataset, "train")
    val_ds = JsonlVLMDataset(args.dataset, "val")
    print(f"{len(train_ds)} train / {len(val_ds)} val examples")

    trainer = Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=args.out,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=8,
            gradient_checkpointing=True,
            bf16=True,
            logging_steps=5,
            eval_strategy="epoch" if len(val_ds) else "no",
            save_strategy="epoch",
            save_total_limit=2,
            remove_unused_columns=False,
            report_to=[],
        ),
        train_dataset=train_ds,
        eval_dataset=val_ds if len(val_ds) else None,
        data_collator=make_collator(processor),
    )
    trainer.train()

    model.save_pretrained(args.out)
    processor.save_pretrained(args.out)
    print(f"LoRA adapter saved to {args.out}. Serve it with: LORA_DIR={Path(args.out).resolve()} bash deploy/vastai/run_services.sh")


if __name__ == "__main__":
    main()

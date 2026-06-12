#!/usr/bin/env python3
"""Convert labeled photo cases into a JSONL SFT dataset.

Reads training_data/<case>/{photo.jpg,label.json} (see training/README.md),
builds the SAME prompt the production server uses for that category, and emits
one JSON line per case:

    {"image": "<abs path>", "prompt": "<full prompt>", "target": "<json string>", "split": "train"|"val"}
"""
import argparse
import json
import random
import sys
from pathlib import Path

# Reuse the production prompt builder so training and inference never drift.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server import CosmosModelDriver  # noqa: E402

driver = CosmosModelDriver.__new__(CosmosModelDriver)  # skip __init__ (no env needed)


def build_prompt(category, expected_batches=None, expected_bag_count=None):
    prompt, schema = driver._get_prompt_and_schema(category, expected_batches, expected_bag_count)
    return (
        f"{prompt}\n\n"
        f"You MUST output raw JSON and ONLY raw JSON. Do not include markdown code block formatting (like ```json). "
        f"The JSON object must match this schema:\n{json.dumps(schema, indent=2)}"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="Directory of labeled cases")
    ap.add_argument("--out", required=True, help="Output JSONL path")
    ap.add_argument("--val-fraction", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    cases = sorted(p for p in Path(args.data).iterdir() if (p / "label.json").exists())
    if not cases:
        sys.exit(f"No labeled cases found in {args.data}")

    random.seed(args.seed)
    rows = []
    for case in cases:
        label = json.loads((case / "label.json").read_text())
        images = list(case.glob("photo.*")) or list(case.glob("*.jpg")) + list(case.glob("*.png"))
        if not images:
            print(f"SKIP {case.name}: no image")
            continue
        if "expected" not in label:
            print(f"SKIP {case.name}: label.json has no 'expected' object")
            continue
        rows.append({
            "image": str(images[0].resolve()),
            "prompt": build_prompt(
                label["category"],
                label.get("expectedBatches"),
                label.get("expectedBagCount"),
            ),
            "target": json.dumps(label["expected"], separators=(",", ":")),
            "split": "val" if random.random() < args.val_fraction else "train",
        })

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    n_train = sum(1 for r in rows if r["split"] == "train")
    print(f"Wrote {len(rows)} examples ({n_train} train / {len(rows) - n_train} val) to {out}")
    if n_train < 100:
        print("WARNING: fewer than 100 training examples — expect weak generalization. Collect more.")


if __name__ == "__main__":
    main()

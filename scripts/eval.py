#!/usr/bin/env python3
"""Accuracy evaluation harness for the Cosmos vision pipeline.

Runs a directory of labeled photos through the edge server's /api/analyze
endpoint and reports per-category accuracy, so prompt/model changes can be
measured instead of guessed at.

Dataset layout (one directory per case):

    eval_data/
      case_001/
        photo.jpg          # the input image
        label.json         # ground truth + request params, e.g.:
                           # {
                           #   "category": "Pallet_Side",
                           #   "expectedBagCount": 36,          (optional, request hint)
                           #   "expectedBatches": ["P18GY43M8"],(optional, request hint)
                           #   "expected": {"bagCount": 36, "detectedStopNumber": 1}
                           # }

Each key in "expected" is compared against the (flattened) analysis response.

Usage:
    python3 scripts/eval.py --data eval_data [--server http://127.0.0.1:8080]
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import requests


def flatten(obj, prefix=""):
    """Flatten nested dicts to dotted keys: {"picklistFields": {"loadNumber": x}} -> picklistFields.loadNumber"""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flatten(v, f"{prefix}{k}."))
    else:
        out[prefix[:-1]] = obj
    return out


def compare(expected, actual):
    """Compare a ground-truth value to the model output (case/whitespace tolerant for strings)."""
    if isinstance(expected, str) and isinstance(actual, str):
        return expected.strip().upper() == actual.strip().upper()
    return expected == actual


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="Path to the labeled eval dataset directory")
    ap.add_argument("--server", default="http://127.0.0.1:8080", help="Edge server base URL")
    ap.add_argument("--verbose", action="store_true", help="Print every field comparison")
    args = ap.parse_args()

    data_dir = Path(args.data)
    cases = sorted(p for p in data_dir.iterdir() if (p / "label.json").exists())
    if not cases:
        sys.exit(f"No cases found in {data_dir} (need <case>/label.json + <case>/photo.jpg)")

    field_results = defaultdict(lambda: [0, 0])  # (category, field) -> [correct, total]
    mock_responses = 0

    for case in cases:
        label = json.loads((case / "label.json").read_text())
        category = label["category"]
        images = list(case.glob("photo.*")) or list(case.glob("*.jpg")) + list(case.glob("*.png"))
        if not images:
            print(f"SKIP {case.name}: no image found")
            continue

        form = {"category": category}
        if label.get("expectedBatches"):
            form["expectedBatches"] = json.dumps(label["expectedBatches"])
        if label.get("expectedBagCount") is not None:
            form["expectedBagCount"] = str(label["expectedBagCount"])

        with open(images[0], "rb") as f:
            resp = requests.post(
                f"{args.server}/api/analyze",
                files={"file": ("photo.jpg", f, "image/jpeg")},
                data=form,
                timeout=180,
            )
        resp.raise_for_status()
        result = resp.json()

        if result.get("source") == "mock":
            mock_responses += 1

        flat = flatten(result)
        for field, expected_val in flatten(label.get("expected", {})).items():
            actual_val = flat.get(field)
            ok = compare(expected_val, actual_val)
            field_results[(category, field)][1] += 1
            field_results[(category, field)][0] += int(ok)
            if args.verbose or not ok:
                mark = "PASS" if ok else "FAIL"
                print(f"{mark}  {case.name}  {category}.{field}: expected {expected_val!r}, got {actual_val!r}")

    if mock_responses:
        print(f"\nWARNING: {mock_responses} response(s) came from the MOCK fallback — "
              "results below do not measure the real model. Check COSMOS_ENDPOINT.")

    print("\n=== Accuracy by category/field ===")
    by_category = defaultdict(lambda: [0, 0])
    for (category, field), (correct, total) in sorted(field_results.items()):
        print(f"{category:30s} {field:40s} {correct}/{total} ({100*correct/total:.0f}%)")
        by_category[category][0] += correct
        by_category[category][1] += total

    print("\n=== Overall by category ===")
    for category, (correct, total) in sorted(by_category.items()):
        print(f"{category:30s} {correct}/{total} ({100*correct/total:.0f}%)")


if __name__ == "__main__":
    main()

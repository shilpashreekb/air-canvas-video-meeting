"""
backend/scripts/train_knn.py

Trains the gesture-recognition KNN classifier.

Data sources combined:
    TRAIN      = custom/processed/train.csv  +  supplementary/processed_public.csv
    VALIDATION = custom/processed/validation.csv   (custom data ONLY — this
                 represents your real target distribution; diluting it with
                 public supplementary data would make K-selection optimize
                 for the wrong distribution)
    TEST       = custom/processed/test.csv         (custom data ONLY, held
                 out and untouched until this final evaluation step)

NO FABRICATED RESULTS (Section 18, absolute rule): this script will refuse
to run if the required custom dataset CSVs don't exist, rather than
producing placeholder numbers. All accuracy/precision/recall/F1/confusion-
matrix values printed and saved by this script come from actually running
it against real data on your machine.

Usage (from backend/ directory):
    python scripts/train_knn.py
"""

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ml.feature_extraction import FEATURE_COLUMNS  # noqa: E402
from app.ml.preprocessing import GESTURE_CLASSES, build_pipeline  # noqa: E402

CANDIDATE_K_VALUES = [1, 3, 5, 7, 9, 11, 13, 15]


def load_features_labels(csv_path: Path):
    df = pd.read_csv(csv_path)
    missing = set(FEATURE_COLUMNS + ["label"]) - set(df.columns)
    if missing:
        raise ValueError(f"{csv_path} is missing expected columns: {missing}")
    X = df[FEATURE_COLUMNS].to_numpy(dtype=np.float64)
    y = df["label"].to_numpy()
    return X, y


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--custom-dir", type=Path, default=Path("dataset/custom/processed"))
    parser.add_argument(
        "--public-csv", type=Path, default=Path("dataset/supplementary/processed_public.csv")
    )
    parser.add_argument("--model-out", type=Path, default=Path("models/gesture_knn.joblib"))
    parser.add_argument("--report-out", type=Path, default=Path("models/evaluation_report.json"))
    args = parser.parse_args()

    train_csv = args.custom_dir / "train.csv"
    val_csv = args.custom_dir / "validation.csv"
    test_csv = args.custom_dir / "test.csv"

    for required in (train_csv, val_csv, test_csv):
        if not required.exists():
            raise SystemExit(
                f"Required file not found: {required}\n"
                "Run collect_custom_dataset.py to record real webcam samples, then "
                "process_custom_dataset.py to build train/validation/test splits, "
                "before training. This script will not fabricate results."
            )

    X_train_custom, y_train_custom = load_features_labels(train_csv)
    X_val, y_val = load_features_labels(val_csv)
    X_test, y_test = load_features_labels(test_csv)

    print(f"Custom train samples: {len(X_train_custom)}")
    print(f"Validation samples (custom only): {len(X_val)}")
    print(f"Test samples (custom only, held out): {len(X_test)}")

    if args.public_csv.exists():
        X_train_public, y_train_public = load_features_labels(args.public_csv)
        X_train = np.vstack([X_train_custom, X_train_public])
        y_train = np.concatenate([y_train_custom, y_train_public])
        print(f"Public supplementary samples added to TRAIN only: {len(X_train_public)}")
    else:
        X_train, y_train = X_train_custom, y_train_custom
        print(
            f"WARNING: public supplementary CSV not found at {args.public_csv} — "
            "training on custom data only. Run process_public_dataset.py first "
            "if you want the supplementary data included."
        )

    print(f"Total training samples: {len(X_train)}\n")

    # --- Select K using validation accuracy ---
    print("=== K selection (evaluated on held-out validation set) ===")
    best_k = None
    best_val_accuracy = -1.0
    k_results = {}
    for k in CANDIDATE_K_VALUES:
        if k > len(X_train):
            print(f"k={k}: skipped (larger than training set size {len(X_train)})")
            continue
        pipeline = build_pipeline(n_neighbors=k)
        pipeline.fit(X_train, y_train)
        val_preds = pipeline.predict(X_val)
        val_acc = accuracy_score(y_val, val_preds)
        k_results[k] = val_acc
        print(f"k={k}: validation accuracy = {val_acc:.4f}")
        if val_acc > best_val_accuracy:
            best_val_accuracy = val_acc
            best_k = k

    if best_k is None:
        raise SystemExit("Could not evaluate any candidate K value — training set too small.")

    print(f"\nSelected K = {best_k} (validation accuracy = {best_val_accuracy:.4f})\n")

    # --- Retrain final pipeline on the full training set with the selected K ---
    final_pipeline = build_pipeline(n_neighbors=best_k)
    final_pipeline.fit(X_train, y_train)

    # --- Final evaluation on the held-out test set (touched only here) ---
    test_preds = final_pipeline.predict(X_test)
    labels_present = sorted(set(y_test) | set(test_preds))

    accuracy = accuracy_score(y_test, test_preds)
    precision = precision_score(y_test, test_preds, average="weighted", zero_division=0)
    recall = recall_score(y_test, test_preds, average="weighted", zero_division=0)
    f1 = f1_score(y_test, test_preds, average="weighted", zero_division=0)
    cm = confusion_matrix(y_test, test_preds, labels=labels_present)

    print("=== Final test set evaluation (actual results from this run) ===")
    print(f"Accuracy:  {accuracy:.4f}")
    print(f"Precision (weighted): {precision:.4f}")
    print(f"Recall (weighted):    {recall:.4f}")
    print(f"F1-score (weighted):  {f1:.4f}")
    print(f"Confusion matrix (labels order = {labels_present}):")
    print(cm)

    # --- Save model + evaluation report ---
    args.model_out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final_pipeline, args.model_out)
    print(f"\nModel pipeline saved to {args.model_out}")

    report = {
        "selected_k": best_k,
        "k_selection_validation_accuracy": k_results,
        "train_samples": int(len(X_train)),
        "validation_samples": int(len(X_val)),
        "test_samples": int(len(X_test)),
        "test_accuracy": float(accuracy),
        "test_precision_weighted": float(precision),
        "test_recall_weighted": float(recall),
        "test_f1_weighted": float(f1),
        "confusion_matrix": cm.tolist(),
        "confusion_matrix_label_order": labels_present,
        "gesture_classes": GESTURE_CLASSES,
    }
    with open(args.report_out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Evaluation report saved to {args.report_out}")


if __name__ == "__main__":
    main()

"""
backend/scripts/process_public_dataset.py

Processes the public "DynamicGesturesDataSet" (the archive.zip you provided,
inspected in Phase 1) into a supplementary CSV usable by train_knn.py.

IMPORTANT — matches the Phase 1 analysis exactly:
    - Only 4 of the ~32 classes in the dataset have a meaningful mapping to
      our Air Canvas commands. Everything else is ignored.
    - This is SUPPLEMENTARY training data only. It never contributes to
      validation or test splits — those must come from your own
      custom-collected webcam data (see process_custom_dataset.py), because
      only your custom data represents actual real-time drawing/erasing
      actions rather than static held poses.
    - GestureDataTest/ (the dataset's own held-out split) is intentionally
      NOT used at all — it's the dataset authors' test split for their
      32-class problem, not a meaningful test set for our 4-class problem.

Usage (from backend/ directory):
    python scripts/process_public_dataset.py \
        --input-dir dataset/supplementary/kaggle_gestures/DynamicGesturesDataSet/GestureData \
        --output-csv dataset/supplementary/processed_public.csv
"""

import argparse
import csv
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # allow `import app.*`

from app.ml.feature_extraction import FEATURE_COLUMNS, NUM_FEATURES  # noqa: E402

# Mapping finalized in Phase 1: dataset class folder -> our Air Canvas class.
# Any class not listed here is ignored.
CLASS_MAP = {
    "s_1fingerup": "draw",
    "s_2fingerup": "erase",
    "s_fist": "clear",
    "s_openpalm": "no_gesture",
}


def process_sequence_csv(csv_path: Path, expected_columns: int) -> pd.DataFrame:
    """
    Read one sequence CSV (one row per frame, 42 landmark columns) and
    return it as a DataFrame with the standard FEATURE_COLUMNS header,
    regardless of whatever header the source file actually has — we trust
    column *position*, not the source file's column names, since we
    verified in Phase 1 that every class file uses the same 42-column
    P{i}_x,P{i}_y layout.
    """
    df = pd.read_csv(csv_path)
    if df.shape[1] != expected_columns:
        raise ValueError(
            f"{csv_path} has {df.shape[1]} columns, expected {expected_columns}. "
            "Dataset structure may differ from what Phase 1 inspected."
        )
    df.columns = FEATURE_COLUMNS
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("dataset/supplementary/kaggle_gestures/DynamicGesturesDataSet/GestureData"),
        help="Path to the extracted GestureData directory (training pool, not GestureDataTest).",
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        default=Path("dataset/supplementary/processed_public.csv"),
        help="Where to write the processed supplementary CSV.",
    )
    args = parser.parse_args()

    if not args.input_dir.exists():
        raise SystemExit(
            f"Input directory not found: {args.input_dir}\n"
            "Extract archive.zip and point --input-dir at its GestureData folder."
        )

    all_rows = []
    per_class_sequence_count = {cls: 0 for cls in CLASS_MAP.values()}
    per_class_frame_count = {cls: 0 for cls in CLASS_MAP.values()}
    skipped_files = 0

    for source_class_dir, mapped_label in CLASS_MAP.items():
        class_dir = args.input_dir / source_class_dir
        if not class_dir.exists():
            print(f"WARNING: expected class directory not found, skipping: {class_dir}")
            continue

        sequence_files = sorted(class_dir.glob("*.csv"))
        for seq_file in sequence_files:
            try:
                df = process_sequence_csv(seq_file, NUM_FEATURES)
            except Exception as exc:  # noqa: BLE001 - report and skip malformed file
                print(f"WARNING: skipping malformed file {seq_file}: {exc}")
                skipped_files += 1
                continue

            df["label"] = mapped_label
            df["source"] = "public"
            df["sequence_id"] = seq_file.stem
            df["source_class"] = source_class_dir

            all_rows.append(df)
            per_class_sequence_count[mapped_label] += 1
            per_class_frame_count[mapped_label] += len(df)

    if not all_rows:
        raise SystemExit("No usable sequences found. Check --input-dir.")

    combined = pd.concat(all_rows, ignore_index=True)

    before = len(combined)
    combined = combined.dropna(subset=FEATURE_COLUMNS)
    dropped_na = before - len(combined)

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(args.output_csv, index=False, quoting=csv.QUOTE_MINIMAL)

    print("=== Public dataset processing complete ===")
    print(f"Output: {args.output_csv}")
    print(f"Total frames written: {len(combined)}")
    print(f"Frames dropped for missing values: {dropped_na}")
    print(f"Malformed files skipped: {skipped_files}")
    print("Sequences per mapped class:")
    for cls, count in per_class_sequence_count.items():
        print(f"  {cls}: {count} sequences, {per_class_frame_count[cls]} frames")
    print(
        "\nReminder: this data is SUPPLEMENTARY ONLY. train_knn.py must combine it "
        "with your custom dataset's TRAIN split alone — never with validation/test."
    )


if __name__ == "__main__":
    main()

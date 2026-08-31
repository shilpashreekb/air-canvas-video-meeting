"""
backend/scripts/process_custom_dataset.py

Processes the raw custom webcam dataset collected via
collect_custom_dataset.py (backend/dataset/custom/raw/user_XXX/session_XXX/)
into train/validation/test CSVs.

CRITICAL — data leakage prevention (Section 16):
    Splitting is done by USER (falling back to session-level splitting if
    too few users have been collected), never by randomly shuffling
    individual frames. Frames from the same recording are highly correlated
    (consecutive frames of the same hand motion), so a random frame-level
    split would leak near-duplicate information between train and test and
    produce misleadingly high accuracy.

Split strategy actually applied (chosen automatically based on how many
users you've collected so far — logged clearly when you run this):
    - 3+ users : all-but-last-two users -> train, second-to-last -> validation,
                 last user -> test  (matches the "User1-3 train / User4 val /
                 User5 test" pattern from Section 16, generalized to however
                 many users you actually collected)
    - 2 users  : user A -> train, user B's sessions split ~50/50 into
                 validation/test (session-level, not frame-level)
    - 1 user   : sessions round-robined across train/validation/test
                 (weakest option — logged as a warning, since it cannot
                 measure cross-user generalization at all)

Usage (from backend/ directory):
    python scripts/process_custom_dataset.py
"""

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ml.feature_extraction import FEATURE_COLUMNS, NUM_FEATURES  # noqa: E402

RAW_COLUMNS = FEATURE_COLUMNS + ["frame_number", "timestamp"]
VALID_LABELS = {"draw", "erase", "clear", "no_gesture"}


def discover_raw_files(raw_dir: Path) -> Dict[str, Dict[str, List[Path]]]:
    """
    Walk backend/dataset/custom/raw/user_XXX/session_XXX/*.csv and return
    {user_id: {session_id: [file paths]}}.
    """
    structure: Dict[str, Dict[str, List[Path]]] = {}
    if not raw_dir.exists():
        return structure

    for user_dir in sorted(raw_dir.iterdir()):
        if not user_dir.is_dir():
            continue
        structure[user_dir.name] = {}
        for session_dir in sorted(user_dir.iterdir()):
            if not session_dir.is_dir():
                continue
            files = sorted(session_dir.glob("*.csv"))
            if files:
                structure[user_dir.name][session_dir.name] = files
    return structure


def load_sample_file(path: Path) -> pd.DataFrame:
    """
    Load one recorded sample CSV. Expected filename pattern:
        <label>_<index>.csv   e.g. draw_001.csv, no_gesture_014.csv
    Label is taken from the filename prefix (before the trailing _NNN),
    validated against VALID_LABELS.
    """
    stem = path.stem
    parts = stem.rsplit("_", 1)
    label = parts[0] if len(parts) == 2 and parts[1].isdigit() else stem

    if label not in VALID_LABELS:
        raise ValueError(f"Could not infer a valid label from filename '{path.name}' (got '{label}')")

    df = pd.read_csv(path)
    missing_cols = set(RAW_COLUMNS) - set(df.columns)
    if missing_cols:
        raise ValueError(f"{path} is missing expected columns: {missing_cols}")

    df = df[RAW_COLUMNS].copy()
    df["label"] = label
    return df


def split_by_user(structure: Dict[str, Dict[str, List[Path]]]) -> Tuple[List[str], List[str], str]:
    """
    Decide which users go to train/validation/test, and report which
    strategy was used. Returns (train_users, other_users_note, strategy).

    Because the exact split logic differs based on user count, this
    returns enough info for main() to build the actual splits.
    """
    users = sorted(structure.keys())
    n = len(users)

    if n >= 3:
        train_users = users[: n - 2]
        val_user = users[n - 2]
        test_user = users[n - 1]
        return train_users, val_user, test_user, "user-level (3+ users)"
    elif n == 2:
        return [users[0]], users[1], users[1], "session-level (2 users: 1 train user, 1 shared val/test user)"
    elif n == 1:
        return [users[0]], users[0], users[0], "session-level (1 user only — weak evaluation)"
    else:
        raise SystemExit(
            "No users found under backend/dataset/custom/raw/. "
            "Run collect_custom_dataset.py first."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=Path("dataset/custom/raw"))
    parser.add_argument("--output-dir", type=Path, default=Path("dataset/custom/processed"))
    args = parser.parse_args()

    structure = discover_raw_files(args.raw_dir)
    if not structure:
        raise SystemExit(
            f"No raw samples found under {args.raw_dir}. "
            "Run collect_custom_dataset.py first to record real webcam samples — "
            "this script never fabricates data."
        )

    train_users, val_designation, test_designation, strategy = split_by_user(structure)
    users = sorted(structure.keys())
    n_users = len(users)

    print(f"Detected {n_users} user(s): {users}")
    print(f"Split strategy: {strategy}")

    train_frames, val_frames, test_frames = [], [], []
    skipped_files = 0
    total_frames_before_na_drop = 0
    total_frames_after_na_drop = 0

    def load_all_for_user(user: str, session_filter=None) -> pd.DataFrame:
        nonlocal skipped_files
        parts = []
        for session, files in structure[user].items():
            if session_filter is not None and session != session_filter:
                continue
            for f in files:
                try:
                    df = load_sample_file(f)
                except Exception as exc:  # noqa: BLE001
                    print(f"WARNING: skipping malformed/invalid file {f}: {exc}")
                    skipped_files += 1
                    continue
                df["user"] = user
                df["session"] = session
                parts.append(df)
        return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()

    if n_users >= 3:
        for u in train_users:
            train_frames.append(load_all_for_user(u))
        val_frames.append(load_all_for_user(val_designation))
        test_frames.append(load_all_for_user(test_designation))

    elif n_users == 2:
        train_frames.append(load_all_for_user(train_users[0]))
        # Split the second user's sessions ~50/50 between val and test.
        shared_user = val_designation
        sessions = sorted(structure[shared_user].keys())
        val_sessions = sessions[: max(1, len(sessions) // 2)]
        test_sessions = sessions[max(1, len(sessions) // 2) :] or val_sessions
        for s in val_sessions:
            val_frames.append(load_all_for_user(shared_user, session_filter=s))
        for s in test_sessions:
            test_frames.append(load_all_for_user(shared_user, session_filter=s))

    else:  # n_users == 1
        print(
            "WARNING: only one user collected. Splitting by session instead of by "
            "user cannot measure cross-user generalization — collect data from more "
            "people before treating validation/test accuracy as meaningful."
        )
        only_user = users[0]
        sessions = sorted(structure[only_user].keys())
        if len(sessions) < 3:
            raise SystemExit(
                f"Only {len(sessions)} session(s) found for the single collected user. "
                "Need at least 3 sessions to form train/validation/test splits, or "
                "collect data from additional users."
            )
        third = max(1, len(sessions) // 3)
        train_sessions = sessions[: len(sessions) - 2 * third]
        val_sessions = sessions[len(sessions) - 2 * third : len(sessions) - third]
        test_sessions = sessions[len(sessions) - third :]
        for s in train_sessions:
            train_frames.append(load_all_for_user(only_user, session_filter=s))
        for s in val_sessions:
            val_frames.append(load_all_for_user(only_user, session_filter=s))
        for s in test_sessions:
            test_frames.append(load_all_for_user(only_user, session_filter=s))

    def finalize(frames: List[pd.DataFrame]) -> pd.DataFrame:
        nonlocal total_frames_before_na_drop, total_frames_after_na_drop
        non_empty = [f for f in frames if not f.empty]
        if not non_empty:
            return pd.DataFrame(columns=RAW_COLUMNS + ["label", "user", "session"])
        combined = pd.concat(non_empty, ignore_index=True)
        total_frames_before_na_drop += len(combined)
        combined = combined.dropna(subset=FEATURE_COLUMNS)
        total_frames_after_na_drop += len(combined)
        return combined

    train_df = finalize(train_frames)
    val_df = finalize(val_frames)
    test_df = finalize(test_frames)

    if train_df.empty or val_df.empty or test_df.empty:
        raise SystemExit(
            "One or more splits ended up empty after loading. Check that every "
            "class (draw/erase/clear/no_gesture) has been recorded, and that "
            "there is enough data across users/sessions for the chosen split."
        )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    train_df.to_csv(args.output_dir / "train.csv", index=False, quoting=csv.QUOTE_MINIMAL)
    val_df.to_csv(args.output_dir / "validation.csv", index=False, quoting=csv.QUOTE_MINIMAL)
    test_df.to_csv(args.output_dir / "test.csv", index=False, quoting=csv.QUOTE_MINIMAL)

    metadata = {
        "strategy": strategy,
        "users_detected": users,
        "train_rows": len(train_df),
        "validation_rows": len(val_df),
        "test_rows": len(test_df),
        "class_counts": {
            split_name: df["label"].value_counts().to_dict()
            for split_name, df in [("train", train_df), ("validation", val_df), ("test", test_df)]
        },
        "frames_dropped_missing_values": total_frames_before_na_drop - total_frames_after_na_drop,
    }
    with open(args.output_dir.parent / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print("\n=== Custom dataset processing complete ===")
    print(f"Train:      {len(train_df)} frames")
    print(f"Validation: {len(val_df)} frames")
    print(f"Test:       {len(test_df)} frames")
    print(f"Frames dropped for missing values: {total_frames_before_na_drop - total_frames_after_na_drop}")
    print(f"Malformed/invalid files skipped: {skipped_files}")
    print(f"Metadata written to {args.output_dir.parent / 'metadata.json'}")
    for split_name, df in [("train", train_df), ("validation", val_df), ("test", test_df)]:
        print(f"{split_name} class counts: {df['label'].value_counts().to_dict()}")


if __name__ == "__main__":
    main()

"""
backend/scripts/collect_custom_dataset.py

Interactive tool to record your own Air Canvas gesture dataset from a
webcam, per Section 12's requirements. This is the PRIMARY project dataset
(Section 8) — run this yourself; it captures real hand-tracking data and
never fabricates samples.

Run (from backend/ directory, with your virtual environment active):
    python scripts/collect_custom_dataset.py --user user_001 --session session_001

Controls (shown on-screen too):
    1        select class: draw
    2        select class: erase
    3        select class: clear
    4        select class: no_gesture
    r        start recording a sample / stop & SAVE the current recording
    c        cancel the in-progress recording (discard, don't save)
    n        start a new session (increments the session number)
    q / ESC  quit (releases webcam and MediaPipe cleanly)

Each saved sample becomes one CSV under:
    dataset/custom/raw/<user>/<session>/<class>_<NNN>.csv
with columns: P0_x,P0_y,...,P20_x,P20_y,frame_number,timestamp

Frames where MediaPipe does not detect a hand are NOT recorded (they would
just be missing-data rows); the on-screen status shows "NO HAND DETECTED"
during those frames so you know to reposition your hand.
"""

import argparse
import csv
import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ml.feature_extraction import FEATURE_COLUMNS  # noqa: E402

CLASS_KEYS = {
    ord("1"): "draw",
    ord("2"): "erase",
    ord("3"): "clear",
    ord("4"): "no_gesture",
}

RAW_HEADER = FEATURE_COLUMNS + ["frame_number", "timestamp"]


def next_sample_index(session_dir: Path, label: str) -> int:
    """
    Find the next unused sample index for this label in this session
    directory, so we never overwrite an existing recording (Section 12,
    point 14).
    """
    existing = list(session_dir.glob(f"{label}_*.csv"))
    if not existing:
        return 1
    indices = []
    for f in existing:
        try:
            indices.append(int(f.stem.rsplit("_", 1)[1]))
        except (IndexError, ValueError):
            continue
    return max(indices, default=0) + 1


def next_session_name(user_dir: Path, current_session: str) -> str:
    """Compute the next session_NNN name given the current one."""
    try:
        prefix, num = current_session.rsplit("_", 1)
        return f"{prefix}_{int(num) + 1:03d}"
    except (ValueError, IndexError):
        # Fallback if the session name doesn't match the expected pattern.
        i = 1
        while (user_dir / f"session_{i:03d}").exists():
            i += 1
        return f"session_{i:03d}"


def landmarks_to_row(hand_landmarks, frame_width: int, frame_height: int, frame_number: int):
    """
    Convert MediaPipe's normalized (0-1) landmarks into a pixel-space row
    matching the public dataset's coordinate convention (Section 14: use
    the actual available coordinates consistently — here that means storing
    in the same units as the supplementary dataset for direct comparability
    before normalization is applied at training time).
    """
    row = []
    for lm in hand_landmarks.landmark:
        row.append(lm.x * frame_width)
        row.append(lm.y * frame_height)
    row.append(frame_number)
    row.append(time.time())
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user", required=True, help="e.g. user_001")
    parser.add_argument("--session", default="session_001", help="e.g. session_001")
    parser.add_argument(
        "--output-root", type=Path, default=Path("dataset/custom/raw"), help="Raw dataset root directory"
    )
    parser.add_argument("--camera-index", type=int, default=0)
    args = parser.parse_args()

    user_dir = args.output_root / args.user
    session = args.session
    session_dir = user_dir / session
    session_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(args.camera_index)
    if not cap.isOpened():
        raise SystemExit(
            f"Could not open webcam at index {args.camera_index}. "
            "Check that no other application is using the camera and that "
            "camera permissions are granted."
        )

    mp_hands = mp.solutions.hands
    mp_drawing = mp.solutions.drawing_utils
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
    )

    current_label = "draw"
    recording = False
    current_sample_rows = []
    frame_counter_in_sample = 0
    hand_detected_this_frame = False

    print("=== Air Canvas Custom Dataset Collector ===")
    print(f"User: {args.user}  Session: {session}")
    print("Press 1/2/3/4 to select class, 'r' to start/stop recording, 'c' to cancel, 'n' for new session, 'q' to quit.\n")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("WARNING: failed to read frame from webcam.")
                break

            frame = cv2.flip(frame, 1)
            frame_height, frame_width = frame.shape[:2]
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(rgb_frame)

            hand_detected_this_frame = bool(results.multi_hand_landmarks)

            if hand_detected_this_frame:
                hand_landmarks = results.multi_hand_landmarks[0]
                mp_drawing.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)

                if recording:
                    frame_counter_in_sample += 1
                    row = landmarks_to_row(hand_landmarks, frame_width, frame_height, frame_counter_in_sample)
                    current_sample_rows.append(row)

            # --- On-screen status overlay ---
            status_color = (0, 0, 255) if recording else (255, 255, 255)
            cv2.putText(frame, f"User: {args.user}  Session: {session}", (10, 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            cv2.putText(frame, f"Class: {current_label}", (10, 55),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            rec_text = f"RECORDING ({frame_counter_in_sample} frames)" if recording else "Not recording (press 'r')"
            cv2.putText(frame, rec_text, (10, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)
            if not hand_detected_this_frame:
                cv2.putText(frame, "NO HAND DETECTED", (10, 115),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)

            cv2.imshow("Air Canvas - Custom Dataset Collection", frame)

            key = cv2.waitKey(1) & 0xFF

            if key in CLASS_KEYS and not recording:
                current_label = CLASS_KEYS[key]
                print(f"Selected class: {current_label}")

            elif key == ord("r"):
                if not recording:
                    recording = True
                    current_sample_rows = []
                    frame_counter_in_sample = 0
                    print(f"Recording started for class '{current_label}'...")
                else:
                    recording = False
                    if len(current_sample_rows) == 0:
                        print("No frames captured (no hand detected during recording) — nothing saved.")
                    else:
                        idx = next_sample_index(session_dir, current_label)
                        out_path = session_dir / f"{current_label}_{idx:03d}.csv"
                        with open(out_path, "w", newline="") as f:
                            writer = csv.writer(f)
                            writer.writerow(RAW_HEADER)
                            writer.writerows(current_sample_rows)
                        print(f"Saved {len(current_sample_rows)} frames -> {out_path}")
                    current_sample_rows = []
                    frame_counter_in_sample = 0

            elif key == ord("c"):
                if recording:
                    print(f"Cancelled recording ({len(current_sample_rows)} frames discarded).")
                    recording = False
                    current_sample_rows = []
                    frame_counter_in_sample = 0
                else:
                    print("Nothing to cancel — not currently recording.")

            elif key == ord("n"):
                if recording:
                    print("Finish or cancel the current recording before starting a new session.")
                else:
                    session = next_session_name(user_dir, session)
                    session_dir = user_dir / session
                    session_dir.mkdir(parents=True, exist_ok=True)
                    print(f"New session: {session}")

            elif key == ord("q") or key == 27:  # 'q' or ESC
                if recording:
                    print("Recording in progress — cancelling before quit (not saved).")
                print("Quitting...")
                break

    finally:
        # Always release resources cleanly, even on error or Ctrl+C
        # (Section 12, point 18).
        cap.release()
        hands.close()
        cv2.destroyAllWindows()
        print("Webcam and MediaPipe resources released.")


if __name__ == "__main__":
    main()

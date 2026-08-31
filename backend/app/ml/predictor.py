"""
Real-time-style gesture predictor.

Role in the overall architecture (decided in Phase 1, Section 20): live,
in-meeting gesture prediction runs CLIENT-SIDE in the browser (Phase 6's
gestures.js), not through this backend module — MediaPipe already runs in
JS, and round-tripping every frame's landmarks to the server would add
latency for no benefit. This module exists for:
    1. Offline evaluation (used internally by train_knn.py's test-set pass).
    2. A reference/fallback implementation — e.g. if a future non-browser
       client needs server-side prediction, or for debugging/comparing
       against the JS implementation's output on the same input.

This is a REAL KNN-backed predictor loaded from the joblib pipeline saved
by train_knn.py — not a rule-based stand-in (Section 19: "Do not create a
fake rule-based classifier and call it KNN").
"""

from collections import deque
from pathlib import Path
from typing import Deque, Dict, List, Optional

import joblib
import numpy as np

from app.ml.feature_extraction import NUM_FEATURES, has_missing_landmarks

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "gesture_knn.joblib"


class GesturePredictor:
    """
    Wraps the trained sklearn Pipeline (normalize -> scale -> KNN) and adds
    temporal smoothing/debouncing on top of raw per-frame predictions, so a
    single noisy misclassified frame doesn't trigger an unwanted Air Canvas
    command (Section 19, point 6; Section 21's debouncing requirement).

    Smoothing strategy:
        - Keep a rolling window of the last `window_size` raw predictions.
        - The "confirmed" gesture only changes once a class holds at least
          `min_agreement` votes within that window. This means a gesture
          has to be seen consistently for several consecutive frames before
          it's trusted, which is what prevents e.g. a single frame
          misclassified as "clear" from wiping the canvas.
    """

    def __init__(
        self,
        model_path: Path = DEFAULT_MODEL_PATH,
        window_size: int = 5,
        min_agreement: int = 3,
    ):
        if not model_path.exists():
            raise FileNotFoundError(
                f"No trained model found at {model_path}. Run scripts/train_knn.py "
                "first — this predictor will not fabricate a model."
            )
        self.pipeline = joblib.load(model_path)
        self.window_size = window_size
        self.min_agreement = min_agreement
        self._history: Deque[str] = deque(maxlen=window_size)
        self._confirmed_gesture: str = "no_gesture"

    def reset(self) -> None:
        """Clear prediction history — call this when a user leaves/rejoins a meeting."""
        self._history.clear()
        self._confirmed_gesture = "no_gesture"

    def predict_raw(self, landmarks_flat: List[float]) -> Dict:
        """
        Run the model on a single frame's 42 landmark values, with no
        temporal smoothing applied. Returns the raw per-frame prediction
        and, if available, class probabilities.
        """
        if len(landmarks_flat) != NUM_FEATURES:
            raise ValueError(f"Expected {NUM_FEATURES} landmark values, got {len(landmarks_flat)}.")

        if has_missing_landmarks(landmarks_flat):
            return {"gesture": "no_gesture", "confidence": None, "reason": "missing_landmarks"}

        X = np.asarray(landmarks_flat, dtype=np.float64).reshape(1, -1)
        gesture = self.pipeline.predict(X)[0]

        confidence: Optional[float] = None
        if hasattr(self.pipeline, "predict_proba"):
            proba = self.pipeline.predict_proba(X)[0]
            classes = self.pipeline.classes_
            confidence = float(proba[list(classes).index(gesture)])

        return {"gesture": gesture, "confidence": confidence, "reason": None}

    def predict_smoothed(self, landmarks_flat: List[float]) -> Dict:
        """
        Run the model on a single frame and update the temporal smoothing
        window, returning the *confirmed* (debounced) gesture rather than
        the raw per-frame prediction.

        This is the method the Air Canvas frontend logic conceptually
        mirrors client-side (Phase 6) — kept here as the reference
        implementation and for offline evaluation.
        """
        raw = self.predict_raw(landmarks_flat)
        self._history.append(raw["gesture"])

        if len(self._history) == self._history.maxlen:
            counts = {cls: self._history.count(cls) for cls in set(self._history)}
            top_class = max(counts, key=counts.get)
            if counts[top_class] >= self.min_agreement:
                self._confirmed_gesture = top_class

        return {
            "raw_gesture": raw["gesture"],
            "confidence": raw["confidence"],
            "confirmed_gesture": self._confirmed_gesture,
        }

"""
Shared feature extraction / landmark normalization.

CRITICAL: this module is imported by every place that needs to turn 21 raw
(x, y) MediaPipe landmarks into a model-ready feature vector — the public
dataset processing script, the custom dataset processing script, model
training, and the live predictor. Using the same function everywhere is
what guarantees training/inference consistency (Section 19, point 2 of the
original spec: "Apply the SAME preprocessing as training").

Normalization strategy (decided in Phase 1 discussion, Section 14):
    1. Translate every landmark so the wrist (landmark 0) sits at the
       origin. This removes dependence on where the hand is in the frame.
    2. Scale every coordinate by the wrist -> middle-finger-MCP (landmark 9)
       distance. This removes dependence on hand size / distance from the
       camera. Landmark 9 is a stable "palm size" reference point that
       MediaPipe tracks reliably even during motion.
    3. Only X/Y are used — never Z — because the public supplementary
       dataset has no Z column, and using different feature dimensionality
       for public vs. custom data would make them impossible to combine.

This gives translation- and scale-invariant features while keeping the
pipeline simple enough to reason about and debug for a student project.
"""

import numpy as np

NUM_LANDMARKS = 21
WRIST_IDX = 0
MIDDLE_MCP_IDX = 9  # used as the scale reference point
NUM_FEATURES = NUM_LANDMARKS * 2  # 42

# Column order used consistently across every CSV in this project.
FEATURE_COLUMNS = [f"P{i}_{axis}" for i in range(NUM_LANDMARKS) for axis in ("x", "y")]

# Minimum scale-reference distance before we treat it as degenerate (e.g. a
# MediaPipe misdetection collapsing all landmarks to nearly the same point).
_MIN_SCALE = 1e-6


def normalize_landmarks_batch(X: np.ndarray) -> np.ndarray:
    """
    Normalize a batch of raw landmark feature vectors.

    Args:
        X: array of shape (n_samples, 42), columns ordered as
           P0_x, P0_y, P1_x, P1_y, ..., P20_x, P20_y (raw pixel or raw
           MediaPipe coordinates — either works, since this function makes
           the result scale/translation invariant regardless of input
           units).

    Returns:
        array of shape (n_samples, 42), same column order, normalized.
    """
    X = np.asarray(X, dtype=np.float64)
    if X.ndim == 1:
        X = X.reshape(1, -1)
    if X.shape[1] != NUM_FEATURES:
        raise ValueError(
            f"Expected {NUM_FEATURES} features (21 landmarks x 2 coords), got {X.shape[1]}."
        )

    n_samples = X.shape[0]
    points = X.reshape(n_samples, NUM_LANDMARKS, 2)  # (n, 21, 2)

    wrist = points[:, WRIST_IDX : WRIST_IDX + 1, :]  # (n, 1, 2)
    translated = points - wrist  # (n, 21, 2)

    scale_vector = points[:, MIDDLE_MCP_IDX, :] - points[:, WRIST_IDX, :]  # (n, 2)
    scale = np.linalg.norm(scale_vector, axis=1)  # (n,)
    scale = np.where(scale < _MIN_SCALE, _MIN_SCALE, scale)  # avoid division by zero

    normalized = translated / scale.reshape(n_samples, 1, 1)  # (n, 21, 2)

    return normalized.reshape(n_samples, NUM_FEATURES)


def normalize_landmarks_single(landmarks_flat) -> np.ndarray:
    """
    Convenience wrapper for a single frame's worth of landmarks (e.g. one
    live prediction call). Accepts a flat list/array of 42 values.
    """
    arr = np.asarray(landmarks_flat, dtype=np.float64).reshape(1, -1)
    return normalize_landmarks_batch(arr)[0]


def has_missing_landmarks(landmarks_flat) -> bool:
    """
    True if any coordinate is missing/NaN/None — i.e. this frame does not
    represent a fully-detected hand and should be dropped rather than fed
    to the model.
    """
    arr = np.asarray(landmarks_flat, dtype=np.float64)
    return bool(np.isnan(arr).any())

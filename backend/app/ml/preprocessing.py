"""
Preprocessing pipeline definition.

Wraps normalize_landmarks_batch + StandardScaler + KNeighborsClassifier into
a single sklearn Pipeline so the complete "preprocessing + model" object can
be saved and loaded as one artifact (Section 17: "Prefer saving the
complete preprocessing + model pipeline where practical").
"""

from typing import List

from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from app.ml.feature_extraction import normalize_landmarks_batch

# The four Air Canvas command classes (Section 9). Order here is arbitrary —
# sklearn's LabelEncoder/classifier handles string labels directly — but
# kept consistent for readability in logs/reports.
GESTURE_CLASSES: List[str] = ["draw", "erase", "clear", "no_gesture"]


def build_pipeline(n_neighbors: int) -> Pipeline:
    """
    Build an untrained Pipeline: raw 42-dim landmarks -> normalized
    landmarks -> standardized features -> KNN classifier.

    Using a Pipeline (rather than normalizing manually before calling
    .fit()) guarantees that saved/loaded models always apply the exact same
    normalization + scaling to new data at prediction time — there's no way
    for the predictor to accidentally skip a preprocessing step.
    """
    return Pipeline(
        steps=[
            (
                "normalize",
                FunctionTransformer(normalize_landmarks_batch, validate=False),
            ),
            ("scale", StandardScaler()),
            (
                "knn",
                KNeighborsClassifier(n_neighbors=n_neighbors, weights="distance"),
            ),
        ]
    )

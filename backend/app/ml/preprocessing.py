# backend/app/ml/preprocessing.py

"""
Preprocessing pipeline definition.

Wraps normalize_landmarks_batch + StandardScaler + KNeighborsClassifier into
a single sklearn Pipeline so the complete "preprocessing + model" object can
be saved and loaded as one artifact.
"""

from typing import List, Optional
import numpy as np
import joblib
from pathlib import Path

from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from .feature_extraction import normalize_landmarks_batch

# The four Air Canvas command classes
GESTURE_CLASSES: List[str] = ["draw", "erase", "clear", "no_gesture"]


def build_pipeline(n_neighbors: int = 5) -> Pipeline:
    """
    Build an untrained Pipeline: raw 42-dim landmarks -> normalized
    landmarks -> standardized features -> KNN classifier.
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


def load_pipeline(path: Path) -> Optional[Pipeline]:
    """
    Load a saved pipeline from disk.
    """
    if path.exists():
        try:
            return joblib.load(path)
        except Exception as e:
            print(f"⚠️ Could not load pipeline: {e}")
    return None


def save_pipeline(pipeline: Pipeline, path: Path) -> bool:
    """
    Save a trained pipeline to disk.
    """
    try:
        joblib.dump(pipeline, path)
        print(f"✅ Pipeline saved to {path}")
        return True
    except Exception as e:
        print(f"❌ Failed to save pipeline: {e}")
        return False
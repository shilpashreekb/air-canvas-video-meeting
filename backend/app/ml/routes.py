"""
Gesture prediction API routes.

Receives 42 MediaPipe X/Y landmark values from the frontend and
runs the trained KNN pipeline through GesturePredictor.
"""

from typing import List

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.ml.predictor import GesturePredictor

router = APIRouter(prefix="/api/gesture", tags=["gesture"])

predictor = GesturePredictor()


class GesturePredictionRequest(BaseModel):
    landmarks: List[float] = Field(
        ...,
        min_length=42,
        max_length=42,
        description="42 X/Y values for MediaPipe's 21 hand landmarks.",
    )


@router.post("/predict")
def predict_gesture(payload: GesturePredictionRequest):
    """Predict the gesture from one frame of hand landmarks."""

    result = predictor.predict_smoothed(payload.landmarks)

    return {
        "raw_gesture": result["raw_gesture"],
        "confirmed_gesture": result["confirmed_gesture"],
        "confidence": result["confidence"],
    }
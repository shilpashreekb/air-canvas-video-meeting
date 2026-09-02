# backend/app/ml/routes.py

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from pathlib import Path

from .feature_extraction import normalize_landmarks_single, has_missing_landmarks, NUM_FEATURES
from .predictor import GesturePredictor

router = APIRouter(prefix="/api/gesture", tags=["Gesture"])

MODEL_PATH = Path(__file__).parent.parent.parent / "models" / "gesture_knn.joblib"
predictor = GesturePredictor(str(MODEL_PATH))


class GestureRequest(BaseModel):
    landmarks: List[float]


class GestureResponse(BaseModel):
    raw_gesture: str
    confirmed_gesture: str
    confidence: float


@router.post("/predict", response_model=GestureResponse)
async def predict_gesture(request: GestureRequest):
    if not request.landmarks or len(request.landmarks) < NUM_FEATURES:
        raise HTTPException(status_code=400, detail=f"Expected {NUM_FEATURES} values")
    
    print(f"📥 Received {len(request.landmarks)} landmarks")
    print(f"📥 First 10: {request.landmarks[:10]}")
    
    if has_missing_landmarks(request.landmarks):
        return GestureResponse(raw_gesture="no_gesture", confirmed_gesture="no_gesture", confidence=0.0)
    
    try:
        normalized = normalize_landmarks_single(request.landmarks[:NUM_FEATURES])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Normalization error: {str(e)}")
    
    result = predictor.predict(normalized.tolist())
    
    return GestureResponse(
        raw_gesture=result['raw_gesture'],
        confirmed_gesture=result['confirmed_gesture'],
        confidence=result['confidence']
    )


@router.get("/health")
async def gesture_health():
    return {
        "status": "healthy",
        "model_loaded": predictor.is_loaded
    }
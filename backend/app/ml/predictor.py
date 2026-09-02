# backend/app/ml/predictor.py

import numpy as np
from typing import List, Dict, Any, Optional
from sklearn.pipeline import Pipeline
from pathlib import Path
import joblib

from .feature_extraction import (
    normalize_landmarks_single,
    has_missing_landmarks,
    NUM_FEATURES
)


# ============================================================
# GESTURE CLASSES
# ============================================================

GESTURE_CLASSES = {
    "draw": 0,
    "erase": 1,
    "clear": 2,
    "no_gesture": 3
}

REVERSE_CLASSES = {
    0: "draw",
    1: "erase",
    2: "clear",
    3: "no_gesture"
}


# ============================================================
# GESTURE PREDICTOR
# ============================================================

class GesturePredictor:

    def __init__(self, model_path: Optional[str] = None):

        self.model: Optional[Pipeline] = None
        self.model_path: Optional[Path] = None
        self.is_loaded = False

        if model_path:

            self.model_path = Path(model_path)

            self.load(
                self.model_path
            )


    # ========================================================
    # LOAD MODEL
    # ========================================================

    def load(
        self,
        model_path: Path
    ) -> bool:

        try:

            if model_path.exists():

                self.model = joblib.load(
                    model_path
                )

                self.is_loaded = True

                print(
                    f"✅ GesturePredictor loaded from {model_path}"
                )

                # Show model classes if available
                if hasattr(
                    self.model,
                    "classes_"
                ):

                    print(
                        "🔵 Model classes:",
                        self.model.classes_
                    )

                return True

        except Exception as e:

            print(
                f"⚠️ Failed to load model: {e}"
            )

            self.model = None
            self.is_loaded = False

        return False


    # ========================================================
    # MAIN PREDICTION
    # ========================================================

    def predict(
        self,
        landmarks: List[float]
    ) -> Dict[str, Any]:

        # ----------------------------------------------------
        # CHECK LANDMARK COUNT
        # ----------------------------------------------------

        if (
            landmarks is None or
            len(landmarks) < NUM_FEATURES
        ):

            print(
                f"⚠️ Invalid landmarks: {len(landmarks) if landmarks else 0}"
            )

            return {

                "raw_gesture":
                    "no_gesture",

                "confirmed_gesture":
                    "no_gesture",

                "confidence":
                    0.0,

                "probabilities":
                    {}

            }


        # ----------------------------------------------------
        # TAKE FIRST 42 VALUES
        # ----------------------------------------------------

        X = np.array(
            landmarks[:NUM_FEATURES],
            dtype=np.float32
        ).reshape(
            1,
            -1
        )


        print(
            f"📥 Received {len(landmarks)} landmarks"
        )

        print(
            f"📥 First 10: {landmarks[:10]}"
        )

        print(
            f"🔵 Prediction shape: {X.shape}"
        )


        # ====================================================
        # USE TRAINED MODEL
        # ====================================================

        if (
            self.is_loaded and
            self.model is not None
        ):

            try:

                print(
                    "🔵 Using trained gesture model"
                )


                # ------------------------------------------------
                # MODEL PREDICTION
                # ------------------------------------------------

                pred_label = self.model.predict(
                    X
                )[0]


                print(
                    f"🔵 Raw model label: {pred_label}"
                )


                # ------------------------------------------------
                # PROBABILITIES
                # ------------------------------------------------

                probabilities = {}

                if hasattr(
                    self.model,
                    "predict_proba"
                ):

                    probs = self.model.predict_proba(
                        X
                    )[0]

                    confidence = float(
                        np.max(probs)
                    )

                    print(
                        f"🔵 Model probabilities: {probs}"
                    )


                    # Try to associate probabilities
                    # with the model's actual class labels

                    if hasattr(
                        self.model,
                        "classes_"
                    ):

                        classes = self.model.classes_

                        for cls, prob in zip(
                            classes,
                            probs
                        ):

                            if isinstance(
                                cls,
                                str
                            ):

                                gesture_name = cls

                            else:

                                gesture_name = REVERSE_CLASSES.get(
                                    int(cls),
                                    "unknown"
                                )

                            probabilities[
                                gesture_name
                            ] = float(prob)

                else:

                    confidence = 1.0


                # =================================================
                # IMPORTANT:
                # MODEL MAY RETURN STRING LABEL
                # =================================================

                if isinstance(
                    pred_label,
                    str
                ):

                    raw_gesture = (
                        pred_label
                        .strip()
                        .lower()
                    )

                else:

                    try:

                        raw_gesture = REVERSE_CLASSES.get(
                            int(pred_label),
                            "no_gesture"
                        )

                    except (
                        ValueError,
                        TypeError
                    ):

                        raw_gesture = "no_gesture"


                # ------------------------------------------------
                # VALIDATE GESTURE
                # ------------------------------------------------

                valid_gestures = {

                    "draw",
                    "erase",
                    "clear",
                    "no_gesture"

                }

                if raw_gesture not in valid_gestures:

                    print(
                        f"⚠️ Unknown model gesture: {raw_gesture}"
                    )

                    raw_gesture = "no_gesture"


                # ------------------------------------------------
                # CONFIDENCE THRESHOLD
                # ------------------------------------------------

                if confidence >= 0.60:

                    confirmed_gesture = raw_gesture

                else:

                    confirmed_gesture = "no_gesture"


                print(
                    f"🎯 MODEL RESULT: "
                    f"{confirmed_gesture} "
                    f"(confidence: {confidence:.3f})"
                )


                return {

                    "raw_gesture":
                        raw_gesture,

                    "confirmed_gesture":
                        confirmed_gesture,

                    "confidence":
                        confidence,

                    "probabilities":
                        probabilities

                }


            except Exception as e:

                print(
                    f"⚠️ Prediction error: {e}"
                )

                print(
                    "🟡 Switching to fallback classifier..."
                )


        # ====================================================
        # FALLBACK CLASSIFIER
        # ====================================================

        return self._fallback_predict(
            landmarks
        )


    # ========================================================
    # FALLBACK CLASSIFIER
    # ========================================================

    def _fallback_predict(
        self,
        landmarks: List[float]
    ) -> Dict[str, Any]:

        print(
            "🟡 Using fallback gesture classifier"
        )


        # ----------------------------------------------------
        # CHECK INPUT
        # ----------------------------------------------------

        if (
            landmarks is None or
            len(landmarks) < NUM_FEATURES
        ):

            return {

                "raw_gesture":
                    "no_gesture",

                "confirmed_gesture":
                    "no_gesture",

                "confidence":
                    0.0,

                "probabilities":
                    {}

            }


        # ----------------------------------------------------
        # 42 VALUES → 21 LANDMARKS × 2
        # ----------------------------------------------------

        lm = np.array(
            landmarks[:NUM_FEATURES],
            dtype=np.float32
        ).reshape(
            21,
            2
        )


        print(
            "🔵 Converted landmarks to 21 × 2"
        )


        # ====================================================
        # COUNT RAISED FINGERS
        # ====================================================

        fingers = 0


        # ----------------------------------------------------
        # INDEX
        # ----------------------------------------------------

        if lm[8][1] < lm[6][1]:

            fingers += 1

            print(
                f"   ✅ INDEX RAISED: "
                f"tip={lm[8][1]:.3f} "
                f"< pip={lm[6][1]:.3f}"
            )

        else:

            print(
                f"   ❌ INDEX DOWN: "
                f"tip={lm[8][1]:.3f} "
                f">= pip={lm[6][1]:.3f}"
            )


        # ----------------------------------------------------
        # MIDDLE
        # ----------------------------------------------------

        if lm[12][1] < lm[10][1]:

            fingers += 1

            print(
                f"   ✅ MIDDLE RAISED: "
                f"tip={lm[12][1]:.3f} "
                f"< pip={lm[10][1]:.3f}"
            )

        else:

            print(
                f"   ❌ MIDDLE DOWN: "
                f"tip={lm[12][1]:.3f} "
                f">= pip={lm[10][1]:.3f}"
            )


        # ----------------------------------------------------
        # RING
        # ----------------------------------------------------

        if lm[16][1] < lm[14][1]:

            fingers += 1

            print(
                "   ✅ RING RAISED"
            )

        else:

            print(
                "   ❌ RING DOWN"
            )


        # ----------------------------------------------------
        # PINKY
        # ----------------------------------------------------

        if lm[20][1] < lm[18][1]:

            fingers += 1

            print(
                "   ✅ PINKY RAISED"
            )

        else:

            print(
                "   ❌ PINKY DOWN"
            )


        # ----------------------------------------------------
        # THUMB
        # ----------------------------------------------------

        thumb_up = (
            lm[4][0] > lm[3][0]
        )

        if thumb_up:

            fingers += 1

            print(
                "   ✅ THUMB RAISED"
            )

        else:

            print(
                "   ❌ THUMB DOWN"
            )


        print(
            f"🔍 TOTAL FINGERS RAISED: {fingers}"
        )


        # ====================================================
        # CLASSIFICATION
        # ====================================================

        if fingers == 1:

            gesture = "draw"

            confidence = 0.85


        elif fingers == 2:

            gesture = "erase"

            confidence = 0.85


        elif fingers == 0:

            # ------------------------------------------------
            # FIST / CLEAR
            # ------------------------------------------------

            is_fist = (

                lm[8][1] > lm[6][1]

                and

                lm[12][1] > lm[10][1]

                and

                lm[16][1] > lm[14][1]

                and

                lm[20][1] > lm[18][1]

            )


            if is_fist:

                gesture = "clear"

                confidence = 0.85

            else:

                gesture = "no_gesture"

                confidence = 0.30


        else:

            gesture = "no_gesture"

            confidence = 0.30


        # ====================================================
        # FINAL RESULT
        # ====================================================

        confirmed_gesture = (

            gesture

            if confidence >= 0.50

            else

            "no_gesture"

        )


        print(
            f"🎯 FALLBACK RESULT: "
            f"{confirmed_gesture} "
            f"(fingers: {fingers})"
        )


        return {

            "raw_gesture":
                gesture,

            "confirmed_gesture":
                confirmed_gesture,

            "confidence":
                confidence,

            "probabilities":
                {}

        }
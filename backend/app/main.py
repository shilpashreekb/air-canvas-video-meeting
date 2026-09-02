from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import numpy as np
from typing import List, Dict, Optional
import uuid
import joblib
import os


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# GESTURE PREDICTOR
# ============================================================

class GesturePredictor:

    def __init__(self):

        model_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "models",
            "gesture_knn.joblib"
        )

        if os.path.exists(model_path):

            try:
                self.model = joblib.load(model_path)

                self.is_ml = True

                print(f"✅ GesturePredictor loaded from {model_path}")
                print(f"🔵 Model classes: {self.model.classes_}")

            except Exception as e:

                self.is_ml = False

                print("❌ Failed to load model")
                print("   Error:", e)
                print("ℹ️ Using rule-based prediction")

        else:

            self.is_ml = False

            print("ℹ️ No model found, using rule-based prediction")

        self.current_gesture = "no_gesture"
        self.consecutive_frames = 0
        self.required_frames = 3


    def predict(self, landmarks: List[float]):

        if len(landmarks) < 42:

            return {
                "raw_gesture": "no_gesture",
                "confirmed_gesture": "no_gesture",
                "confidence": 0
            }


        if self.is_ml:

            features = np.array(landmarks).reshape(1, -1)

            proba = self.model.predict_proba(features)[0]

            class_idx = np.argmax(proba)

            raw_gesture = self.model.classes_[class_idx]

            confidence = float(proba[class_idx])


            if raw_gesture == self.current_gesture:

                self.consecutive_frames += 1

            else:

                self.consecutive_frames = 1
                self.current_gesture = raw_gesture


            if self.consecutive_frames >= self.required_frames:

                confirmed = raw_gesture

            else:

                confirmed = "no_gesture"


            return {
                "raw_gesture": str(raw_gesture),
                "confirmed_gesture": str(confirmed),
                "confidence": confidence
            }


        return self.rule_based_predict(landmarks)


    def rule_based_predict(self, landmarks: List[float]):

        points = np.array(landmarks).reshape(21, 2)

        wrist = points[0]

        index_tip = points[8]
        middle_tip = points[12]
        pinky_tip = points[20]
        thumb_tip = points[4]


        dist_index = np.linalg.norm(index_tip - wrist)
        dist_middle = np.linalg.norm(middle_tip - wrist)
        dist_pinky = np.linalg.norm(pinky_tip - wrist)
        dist_thumb = np.linalg.norm(thumb_tip - wrist)


        index_extended = dist_index > 0.3
        middle_extended = dist_middle > 0.3
        pinky_extended = dist_pinky > 0.25


        fist_ratio = (
            dist_index +
            dist_middle +
            dist_pinky
        ) / 3 < 0.2


        open_palm = (
            dist_index > 0.25
            and dist_middle > 0.25
            and dist_pinky > 0.2
            and dist_thumb > 0.2
        )


        if fist_ratio:

            raw_gesture = "erase"

            confidence = (
                0.8 +
                (
                    0.2 *
                    (
                        1 -
                        (
                            dist_index +
                            dist_middle +
                            dist_pinky
                        ) /
                        (3 * 0.2)
                    )
                )
            )


        elif open_palm:

            raw_gesture = "clear"

            confidence = (
                0.7 +
                (
                    0.3 *
                    min(
                        dist_index,
                        dist_middle,
                        dist_pinky
                    ) /
                    0.3
                )
            )


        elif index_extended and middle_extended:

            raw_gesture = "draw"

            confidence = (
                0.7 +
                (
                    0.3 *
                    min(
                        dist_index,
                        dist_middle
                    ) /
                    0.3
                )
            )


        else:

            raw_gesture = "no_gesture"
            confidence = 0.5


        confidence = max(
            0.0,
            min(1.0, confidence)
        )


        if raw_gesture == self.current_gesture:

            self.consecutive_frames += 1

        else:

            self.consecutive_frames = 1
            self.current_gesture = raw_gesture


        if self.consecutive_frames >= self.required_frames:

            confirmed = raw_gesture

        else:

            confirmed = "no_gesture"


        return {
            "raw_gesture": raw_gesture,
            "confirmed_gesture": confirmed,
            "confidence": confidence
        }


predictor = GesturePredictor()


# ============================================================
# PYDANTIC MODELS
# ============================================================

class LandmarksRequest(BaseModel):

    landmarks: List[float]


# ============================================================
# BASIC API
# ============================================================

@app.get("/")
async def root():

    return {
        "message": "Air Canvas Backend Running"
    }


@app.get("/health")
async def health():

    return {
        "status": "healthy"
    }


# ============================================================
# GESTURE PREDICTION
# ============================================================

@app.post("/predict")
async def predict_gesture(request: LandmarksRequest):

    try:

        result = predictor.predict(
            request.landmarks
        )

        return JSONResponse(
            content=result
        )

    except Exception as e:

        print("❌ Error predicting:", e)

        return JSONResponse(
            content={
                "raw_gesture": "no_gesture",
                "confirmed_gesture": "no_gesture",
                "confidence": 0
            },
            status_code=200
        )


# ============================================================
# CONNECTION MANAGER
# ============================================================

class ConnectionManager:

    def __init__(self):

        # meeting_id -> list of users
        self.active_connections: Dict[str, List[dict]] = {}

        # meeting_id -> creator user_id
        self.meeting_creators: Dict[str, str] = {}


    # --------------------------------------------------------
    # CONNECT USER
    # --------------------------------------------------------

    async def connect(
        self,
        websocket: WebSocket,
        meeting_id: str,
        user_name: str
    ):

        await websocket.accept()

        user_id = str(uuid.uuid4())[:8]


        if meeting_id not in self.active_connections:

            self.active_connections[meeting_id] = []


        user = {
            "websocket": websocket,
            "user_id": user_id,
            "user_name": user_name
        }


        self.active_connections[meeting_id].append(
            user
        )


        print(
            f"✅ User connected:"
            f" {user_name}"
            f" ({user_id})"
            f" -> meeting {meeting_id}"
        )


        return user_id


    # --------------------------------------------------------
    # DISCONNECT USER
    # --------------------------------------------------------

    def disconnect(
        self,
        websocket: WebSocket,
        meeting_id: str
    ):

        if meeting_id not in self.active_connections:

            return


        connections = self.active_connections[meeting_id]


        removed_user = None


        for conn in connections:

            if conn["websocket"] == websocket:

                removed_user = conn

                connections.remove(conn)

                break


        if removed_user:

            print(
                f"👋 User disconnected:"
                f" {removed_user['user_name']}"
                f" ({removed_user['user_id']})"
            )


        if not connections:

            del self.active_connections[
                meeting_id
            ]


            if meeting_id in self.meeting_creators:

                del self.meeting_creators[
                    meeting_id
                ]


    # --------------------------------------------------------
    # BROADCAST
    # --------------------------------------------------------

    async def broadcast(
        self,
        meeting_id: str,
        message: dict,
        exclude: Optional[WebSocket] = None
    ):

        if meeting_id not in self.active_connections:

            return


        for conn in self.active_connections[
            meeting_id
        ]:

            if conn["websocket"] == exclude:

                continue


            try:

                await conn["websocket"].send_json(
                    message
                )

            except Exception as e:

                print(
                    "⚠️ Failed to send message:",
                    e
                )


    # --------------------------------------------------------
    # SEND TO SPECIFIC USER
    # --------------------------------------------------------

    async def send_to_user(
        self,
        meeting_id: str,
        target_user_id: str,
        message: dict
    ):

        if meeting_id not in self.active_connections:

            return False


        for conn in self.active_connections[
            meeting_id
        ]:

            if conn["user_id"] == target_user_id:

                try:

                    await conn["websocket"].send_json(
                        message
                    )

                    return True

                except Exception as e:

                    print(
                        "⚠️ Failed to send to user:",
                        e
                    )

                    return False


        return False


    # --------------------------------------------------------
    # GET USER
    # --------------------------------------------------------

    def get_user_info(
        self,
        meeting_id: str,
        user_id: str
    ):

        if meeting_id not in self.active_connections:

            return None


        for conn in self.active_connections[
            meeting_id
        ]:

            if conn["user_id"] == user_id:

                return conn


        return None


    # --------------------------------------------------------
    # GET ALL PARTICIPANTS
    # --------------------------------------------------------

    def get_participants(
        self,
        meeting_id: str
    ):

        if meeting_id not in self.active_connections:

            return []


        return [
            {
                "user_id": conn["user_id"],
                "user_name": conn["user_name"],
                "is_creator": (
                    conn["user_id"]
                    ==
                    self.meeting_creators.get(
                        meeting_id
                    )
                )
            }

            for conn in self.active_connections[
                meeting_id
            ]
        ]


manager = ConnectionManager()


# ============================================================
# WEBSOCKET
# ============================================================

@app.websocket("/ws/{meeting_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    meeting_id: str
):

    # --------------------------------------------------------
    # FIRST MESSAGE = JOIN / CREATE
    # --------------------------------------------------------

    try:

        first_data = await websocket.receive_json()

        user_name = (
            first_data.get(
                "user_name",
                "User"
            ).strip()
            or "User"
        )

        message_type = first_data.get(
            "type",
            "join_meeting"
        )

    except Exception:

        user_name = "User"

        message_type = "join_meeting"


    # --------------------------------------------------------
    # CONNECT
    # --------------------------------------------------------

    user_id = await manager.connect(
        websocket,
        meeting_id,
        user_name
    )


    try:

        # ====================================================
        # CREATE MEETING
        # ====================================================

        if message_type == "create_meeting":

            manager.meeting_creators[
                meeting_id
            ] = user_id


            print(
                f"👑 Meeting {meeting_id}"
                f" created by {user_name}"
                f" ({user_id})"
            )


            # Tell creator their identity
            await websocket.send_json({

                "type": "self_info",

                "user_id": user_id,

                "user_name": user_name,

                "is_creator": True

            })


        # ====================================================
        # JOIN MEETING
        # ====================================================

        else:

            print(
                f"👤 {user_name}"
                f" is joining meeting"
                f" {meeting_id}"
            )


            # ------------------------------------------------
            # Send identity to participant
            # ------------------------------------------------

            await websocket.send_json({

                "type": "self_info",

                "user_id": user_id,

                "user_name": user_name,

                "is_creator": False

            })


            # ------------------------------------------------
            # Send creator information
            # ------------------------------------------------

            creator_id = manager.meeting_creators.get(
                meeting_id
            )


            if creator_id:

                creator_info = manager.get_user_info(
                    meeting_id,
                    creator_id
                )


                if creator_info:

                    await websocket.send_json({

                        "type": "creator_info",

                        "creator_id": creator_id,

                        "creator_name": creator_info[
                            "user_name"
                        ]

                    })


                    print(
                        f"📛 Sent creator name"
                        f" '{creator_info['user_name']}'"
                        f" to {user_name}"
                    )


            # ------------------------------------------------
            # Send existing participants to new user
            # ------------------------------------------------

            existing_participants = (
                manager.get_participants(
                    meeting_id
                )
            )


            for participant in existing_participants:

                if participant["user_id"] == user_id:

                    continue


                await websocket.send_json({

                    "type": "existing_participant",

                    "user_id": participant[
                        "user_id"
                    ],

                    "user_name": participant[
                        "user_name"
                    ],

                    "is_creator": participant[
                        "is_creator"
                    ]

                })


            # ------------------------------------------------
            # Tell everyone else that this user joined
            # ------------------------------------------------

            await manager.broadcast(
                meeting_id,

                {
                    "type": "participant_joined",

                    "user_id": user_id,

                    "user_name": user_name,

                    "is_creator": False

                },

                exclude=websocket
            )


        # ====================================================
        # MAIN MESSAGE LOOP
        # ====================================================

        while True:

            data = await websocket.receive_json()

            message_type = data.get(
                "type"
            )


            # =================================================
            # WEBRTC OFFER
            # =================================================

            if message_type == "offer":

                print(
                    f"📤 OFFER from"
                    f" {user_name}"
                )


                await manager.broadcast(

                    meeting_id,

                    {
                        "type": "offer",

                        "offer": data.get(
                            "offer"
                        ),

                        "from": user_id,

                        "from_name": user_name

                    },

                    exclude=websocket

                )


            # =================================================
            # WEBRTC ANSWER
            # =================================================

            elif message_type == "answer":

                print(
                    f"📤 ANSWER from"
                    f" {user_name}"
                )


                await manager.broadcast(

                    meeting_id,

                    {
                        "type": "answer",

                        "answer": data.get(
                            "answer"
                        ),

                        "from": user_id,

                        "from_name": user_name

                    },

                    exclude=websocket

                )


            # =================================================
            # ICE CANDIDATE
            # =================================================

            elif message_type == "ice-candidate":

                await manager.broadcast(

                    meeting_id,

                    {
                        "type": "ice-candidate",

                        "candidate": data.get(
                            "candidate"
                        ),

                        "from": user_id,

                        "from_name": user_name

                    },

                    exclude=websocket

                )


            # =================================================
            # DRAW DATA
            #
            # IMPORTANT:
            # NO PERMISSION CHECK HERE.
            #
            # BOTH HOST AND PARTICIPANT ARE ALLOWED TO DRAW.
            # =================================================

            elif message_type == "draw_data":

                action = data.get(
                    "action",
                    "draw"
                )


                x = data.get(
                    "x",
                    0
                )


                y = data.get(
                    "y",
                    0
                )


                last_x = data.get(
                    "lastX",
                    0
                )


                last_y = data.get(
                    "lastY",
                    0
                )


                print(
                    f"🖌️ DRAW from"
                    f" {user_name}"
                    f" | action={action}"
                    f" | x={x}"
                    f" | y={y}"
                )


                # ------------------------------------------------
                # SEND DRAWING TO EVERY OTHER USER
                # ------------------------------------------------

                await manager.broadcast(

                    meeting_id,

                    {
                        "type": "draw_data",

                        "user_id": user_id,

                        "user_name": user_name,

                        "action": action,

                        "x": x,

                        "y": y,

                        "lastX": last_x,

                        "lastY": last_y,

                        "color": data.get(
                            "color",
                            "#00ff00"
                        ),

                        "lineWidth": data.get(
                            "lineWidth",
                            3
                        )

                    },

                    exclude=websocket

                )


            # =================================================
            # CLEAR CANVAS
            # =================================================

            elif message_type == "clear_canvas":

                print(
                    f"🧹 CLEAR from"
                    f" {user_name}"
                )


                await manager.broadcast(

                    meeting_id,

                    {
                        "type": "clear_canvas",

                        "user_id": user_id,

                        "user_name": user_name

                    },

                    exclude=websocket

                )


            # =================================================
            # LEAVE MEETING
            # =================================================

            elif message_type == "leave_meeting":

                print(
                    f"🚪 {user_name}"
                    f" left meeting"
                    f" {meeting_id}"
                )


                await manager.broadcast(

                    meeting_id,

                    {
                        "type": "participant_left",

                        "user_id": user_id,

                        "user_name": user_name

                    },

                    exclude=websocket

                )


                break


            # =================================================
            # UNKNOWN MESSAGE
            # =================================================

            else:

                print(
                    f"⚠️ Unknown message"
                    f" from {user_name}:"
                    f" {message_type}"
                )


    # ========================================================
    # DISCONNECTED
    # ========================================================

    except WebSocketDisconnect:

        print(
            f"🔌 WebSocket disconnected:"
            f" {user_name}"
        )


        manager.disconnect(
            websocket,
            meeting_id
        )


        await manager.broadcast(

            meeting_id,

            {
                "type": "participant_left",

                "user_id": user_id,

                "user_name": user_name

            }

        )


    # ========================================================
    # OTHER ERROR
    # ========================================================

    except Exception as e:

        print(
            f"❌ WebSocket error"
            f" for {user_name}:",
            e
        )


        manager.disconnect(
            websocket,
            meeting_id
        )


# ============================================================
# RUN SERVER
# ============================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000
    )
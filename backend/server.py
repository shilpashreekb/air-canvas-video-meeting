from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import json
import os
import uuid
import joblib
import numpy as np


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
# LOAD TRAINED GESTURE MODEL
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATHS = [
    os.path.join(BASE_DIR, "..", "models", "gesture_knn.joblib"),
    os.path.join(BASE_DIR, "models", "gesture_knn.joblib"),
    os.path.join(BASE_DIR, "gesture_knn.joblib"),
]

gesture_model = None
loaded_model_path = None

for model_path in MODEL_PATHS:
    model_path = os.path.abspath(model_path)

    if os.path.exists(model_path):
        try:
            gesture_model = joblib.load(model_path)
            loaded_model_path = model_path

            print("=" * 60)
            print("✅ GESTURE MODEL LOADED")
            print(f"📁 Model path: {model_path}")

            if hasattr(gesture_model, "classes_"):
                print(f"🧠 Model classes: {gesture_model.classes_}")

            print("=" * 60)

            break

        except Exception as error:
            print("=" * 60)
            print("❌ MODEL LOAD ERROR")
            print(f"📁 Path: {model_path}")
            print(f"Error: {error}")
            print("=" * 60)


if gesture_model is None:
    print("=" * 60)
    print("❌ WARNING: gesture_knn.joblib NOT FOUND")
    print("The /predict endpoint cannot use the trained model.")
    print("Check that the model exists in:")
    print("air-canvas-video-meeting/models/gesture_knn.joblib")
    print("=" * 60)


# ============================================================
# PYDANTIC MODEL
# ============================================================

class LandmarksInput(BaseModel):
    landmarks: List[float]


# ============================================================
# CONNECTION MANAGER
# ============================================================

class ConnectionManager:

    def __init__(self):
        self.rooms: Dict[str, List[Dict[str, Any]]] = {}

    async def connect(
        self,
        room_id: str,
        websocket: WebSocket,
        user_id: str,
        user_name: str,
        is_creator: bool
    ):
        await websocket.accept()

        if room_id not in self.rooms:
            self.rooms[room_id] = []

        connection = {
            "websocket": websocket,
            "user_id": user_id,
            "user_name": user_name,
            "is_creator": is_creator
        }

        self.rooms[room_id].append(connection)

        print(
            f"✅ CONNECTED | "
            f"Room={room_id} | "
            f"Name={user_name} | "
            f"ID={user_id} | "
            f"Creator={is_creator}"
        )

    def disconnect(
        self,
        room_id: str,
        websocket: WebSocket
    ):

        if room_id not in self.rooms:
            return

        self.rooms[room_id] = [
            connection
            for connection in self.rooms[room_id]
            if connection["websocket"] != websocket
        ]

        if not self.rooms[room_id]:
            del self.rooms[room_id]

        print(
            f"👋 Disconnected from room: {room_id}"
        )

    def get_connections(self, room_id: str):

        return self.rooms.get(room_id, [])

    def get_connection(
        self,
        room_id: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:

        for connection in self.rooms.get(room_id, []):

            if connection["user_id"] == user_id:
                return connection

        return None

    def get_creator(self, room_id: str):

        for connection in self.rooms.get(room_id, []):

            if connection["is_creator"]:
                return connection

        return None

    async def send_to_user(
        self,
        room_id: str,
        user_id: str,
        message: dict
    ):

        connection = self.get_connection(
            room_id,
            user_id
        )

        if connection is None:
            return False

        try:

            await connection["websocket"].send_json(
                message
            )

            return True

        except Exception as error:

            print(
                f"❌ Error sending to user: {error}"
            )

            return False

    async def broadcast(
        self,
        room_id: str,
        message: dict,
        exclude_websocket: Optional[WebSocket] = None
    ):

        connections = self.rooms.get(
            room_id,
            []
        )

        for connection in connections:

            websocket = connection["websocket"]

            if websocket == exclude_websocket:
                continue

            try:

                await websocket.send_json(
                    message
                )

            except Exception as error:

                print(
                    f"❌ Broadcast error for "
                    f"{connection['user_name']}: {error}"
                )


manager = ConnectionManager()


# ============================================================
# ROOT
# ============================================================

@app.get("/")
async def root():

    classes = []

    if (
        gesture_model is not None
        and hasattr(gesture_model, "classes_")
    ):

        classes = [
            str(item)
            for item in gesture_model.classes_
        ]

    return {
        "message": "Air Canvas Backend Running",
        "model_loaded": gesture_model is not None,
        "model_path": loaded_model_path,
        "classes": classes
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
async def health():

    return {
        "status": "healthy",
        "model_loaded": gesture_model is not None
    }


# ============================================================
# GESTURE PREDICTION
# ============================================================

@app.post("/predict")
async def predict_gesture(
    data: LandmarksInput
):

    if gesture_model is None:

        return {
            "raw_gesture": "no_gesture",
            "confirmed_gesture": "no_gesture",
            "confidence": 0.0,
            "error": "gesture_knn.joblib not loaded"
        }

    if len(data.landmarks) < 42:

        return {
            "raw_gesture": "no_gesture",
            "confirmed_gesture": "no_gesture",
            "confidence": 0.0
        }

    try:

        features = np.array(
            data.landmarks,
            dtype=np.float32
        ).reshape(1, -1)

        prediction = gesture_model.predict(
            features
        )

        predicted_class = str(
            prediction[0]
        ).strip().lower()

        confidence = 0.0

        if hasattr(
            gesture_model,
            "predict_proba"
        ):

            probabilities = (
                gesture_model.predict_proba(
                    features
                )[0]
            )

            confidence = float(
                np.max(probabilities)
            )

        gesture_aliases = {
            "none": "no_gesture",
            "no gesture": "no_gesture",
            "no_gesture": "no_gesture",
            "nogesture": "no_gesture",
            "draw": "draw",
            "erase": "erase",
            "clear": "clear"
        }

        confirmed_gesture = gesture_aliases.get(
            predicted_class,
            predicted_class
        )

        result = {
            "raw_gesture": predicted_class,
            "confirmed_gesture": confirmed_gesture,
            "confidence": confidence
        }

        print(
            f"🖐️ Gesture: "
            f"{confirmed_gesture} "
            f"({confidence * 100:.1f}%)"
        )

        return result

    except Exception as error:

        print(
            f"❌ Prediction error: {error}"
        )

        return {
            "raw_gesture": "no_gesture",
            "confirmed_gesture": "no_gesture",
            "confidence": 0.0,
            "error": str(error)
        }


# ============================================================
# WEBSOCKET
# ============================================================

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str
):

    user_id = str(
        uuid.uuid4()
    )[:8]

    user_name = "User"
    is_creator = False

    try:

        # ====================================================
        # RECEIVE FIRST MESSAGE
        # ====================================================

        try:

            first_message = await websocket.receive_json()

            message_type = first_message.get(
                "type",
                "join_meeting"
            )

            user_name = (
                first_message.get(
                    "user_name"
                )
                or "User"
            ).strip()

        except Exception:

            message_type = "join_meeting"
            user_name = "User"

        # ====================================================
        # DETERMINE HOST / PARTICIPANT
        # ====================================================

        if message_type == "create_meeting":

            is_creator = True

        elif message_type == "join_meeting":

            is_creator = False

        else:

            await websocket.accept()

            await websocket.send_json({
                "type": "error",
                "message": "Invalid first WebSocket message."
            })

            await websocket.close()

            return

        # ====================================================
        # ROOM LIMIT
        # ====================================================

        current_connections = (
            manager.get_connections(
                room_id
            )
        )

        if len(current_connections) >= 2:

            await websocket.accept()

            await websocket.send_json({
                "type": "room_full",
                "message": "Meeting already has two participants."
            })

            await websocket.close()

            return

        # ====================================================
        # PREVENT SECOND HOST
        # ====================================================

        if is_creator:

            existing_creator = (
                manager.get_creator(
                    room_id
                )
            )

            if existing_creator is not None:

                await websocket.accept()

                await websocket.send_json({
                    "type": "error",
                    "message": "Meeting already has a host."
                })

                await websocket.close()

                return

        # ====================================================
        # REGISTER CONNECTION
        # ====================================================

        await manager.connect(
            room_id=room_id,
            websocket=websocket,
            user_id=user_id,
            user_name=user_name,
            is_creator=is_creator
        )

        # ====================================================
        # SEND SELF INFO
        # ====================================================

        await websocket.send_json({
            "type": "self_info",
            "user_id": user_id,
            "user_name": user_name,
            "is_creator": is_creator
        })

        # ====================================================
        # HOST CREATED MEETING
        # ====================================================

        if is_creator:

            print(
                f"👑 HOST CREATED | "
                f"{user_name} | Room={room_id}"
            )

        # ====================================================
        # PARTICIPANT JOINED
        # ====================================================

        else:

            print(
                f"👤 PARTICIPANT JOINED | "
                f"{user_name} | Room={room_id}"
            )

            creator = manager.get_creator(
                room_id
            )

            # ------------------------------------------------
            # TELL HOST PARTICIPANT JOINED
            # ------------------------------------------------

            await manager.broadcast(
                room_id,
                {
                    "type": "participant_joined",
                    "user_id": user_id,
                    "user_name": user_name,
                    "is_creator": False
                },
                exclude_websocket=websocket
            )

            # ------------------------------------------------
            # TELL PARTICIPANT WHO HOST IS
            # ------------------------------------------------

            if creator:

                await websocket.send_json({
                    "type": "creator_info",
                    "creator_id": creator["user_id"],
                    "creator_name": creator["user_name"]
                })

                # ------------------------------------------------
                # ALSO SEND COMPLETE HOST INFO
                # ------------------------------------------------

                await websocket.send_json({
                    "type": "participant_joined",
                    "user_id": creator["user_id"],
                    "user_name": creator["user_name"],
                    "is_creator": True
                })

        # ====================================================
        # MESSAGE LOOP
        # ====================================================

        while True:

            data = await websocket.receive_json()

            msg_type = data.get("type")

            # =================================================
            # WEBRTC OFFER
            # =================================================

            if msg_type == "offer":

                print(
                    f"📤 OFFER | "
                    f"{user_name} -> room {room_id}"
                )

                await manager.broadcast(
                    room_id,
                    {
                        "type": "offer",
                        "offer": data.get("offer"),
                        "from": user_id,
                        "from_name": user_name
                    },
                    exclude_websocket=websocket
                )

            # =================================================
            # WEBRTC ANSWER
            # =================================================

            elif msg_type == "answer":

                print(
                    f"📤 ANSWER | "
                    f"{user_name} -> room {room_id}"
                )

                await manager.broadcast(
                    room_id,
                    {
                        "type": "answer",
                        "answer": data.get("answer"),
                        "from": user_id,
                        "from_name": user_name
                    },
                    exclude_websocket=websocket
                )

            # =================================================
            # ICE CANDIDATE
            # =================================================
            # Accept both names just in case frontend version
            # uses either spelling.
            # =================================================

            elif msg_type in [
                "ice-candidate",
                "ice_candidate"
            ]:

                print(
                    f"🧊 ICE | "
                    f"{user_name} -> room {room_id}"
                )

                await manager.broadcast(
                    room_id,
                    {
                        "type": "ice-candidate",
                        "candidate": data.get("candidate"),
                        "from": user_id,
                        "from_name": user_name
                    },
                    exclude_websocket=websocket
                )

            # =================================================
            # DRAW DATA
            # =================================================

            elif msg_type == "draw_data":

                action = data.get(
                    "action",
                    "draw"
                )

                draw_message = {
                    "type": "draw_data",

                    "user_id": user_id,
                    "user_name": user_name,

                    "action": action,

                    "x": data.get(
                        "x",
                        0
                    ),

                    "y": data.get(
                        "y",
                        0
                    ),

                    "lastX": data.get(
                        "lastX",
                        0
                    ),

                    "lastY": data.get(
                        "lastY",
                        0
                    ),

                    "color": data.get(
                        "color",
                        "#00ff00"
                    ),

                    "lineWidth": data.get(
                        "lineWidth",
                        3
                    )
                }

                print(
                    f"🎨 DRAW DATA | "
                    f"{user_name} | "
                    f"action={action} | "
                    f"x={draw_message['x']} | "
                    f"y={draw_message['y']}"
                )

                # SEND DRAWING ONLY TO OTHER USER

                await manager.broadcast(
                    room_id,
                    draw_message,
                    exclude_websocket=websocket
                )

            # =================================================
            # CLEAR CANVAS
            # =================================================

            elif msg_type == "clear_canvas":

                print(
                    f"🧹 CLEAR | "
                    f"{user_name} | "
                    f"Room={room_id}"
                )

                await manager.broadcast(
                    room_id,
                    {
                        "type": "clear_canvas",
                        "user_id": user_id,
                        "user_name": user_name
                    },
                    exclude_websocket=websocket
                )

            # =================================================
            # LEAVE
            # =================================================

            elif msg_type == "leave_meeting":

                print(
                    f"👋 LEAVE | "
                    f"{user_name} | "
                    f"Room={room_id}"
                )

                await manager.broadcast(
                    room_id,
                    {
                        "type": "participant_left",
                        "user_id": user_id,
                        "user_name": user_name
                    },
                    exclude_websocket=websocket
                )

                manager.disconnect(
                    room_id,
                    websocket
                )

                break

            # =================================================
            # UNKNOWN MESSAGE
            # =================================================

            else:

                print(
                    f"⚠️ Unknown message type: "
                    f"{msg_type}"
                )

    except WebSocketDisconnect:

        print(
            f"🔌 WebSocket disconnected | "
            f"{user_name} | "
            f"Room={room_id}"
        )

        manager.disconnect(
            room_id,
            websocket
        )

        await manager.broadcast(
            room_id,
            {
                "type": "participant_left",
                "user_id": user_id,
                "user_name": user_name
            },
            exclude_websocket=websocket
        )

    except Exception as error:

        print(
            f"❌ WebSocket error | "
            f"{user_name} | "
            f"{error}"
        )

        manager.disconnect(
            room_id,
            websocket
        )

        await manager.broadcast(
            room_id,
            {
                "type": "participant_left",
                "user_id": user_id,
                "user_name": user_name
            },
            exclude_websocket=websocket
        )


# ============================================================
# RUN SERVER
# ============================================================

if __name__ == "__main__":

    import uvicorn

    print("=" * 60)
    print("🚀 AIR CANVAS BACKEND")
    print("🌐 http://localhost:8000")
    print("🔌 WebSocket: ws://localhost:8000/ws/{room_id}")
    print("=" * 60)

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        reload=False
    )
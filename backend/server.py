from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import os
import uuid
from datetime import datetime, timezone

import joblib
import numpy as np


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(title="Air Canvas Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# SETTINGS
# ============================================================

MAX_PARTICIPANTS = 100
MAX_GUEST_DRAWERS = 2
MAX_DRAWING_HISTORY = 5000


# ============================================================
# LOAD GESTURE MODEL
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATHS = [
    os.path.join(BASE_DIR, "models", "gesture_knn.joblib"),
    os.path.join(BASE_DIR, "..", "models", "gesture_knn.joblib"),
    os.path.join(BASE_DIR, "gesture_knn.joblib"),
]

gesture_model = None
loaded_model_path = None

for model_path in MODEL_PATHS:
    if os.path.exists(model_path):
        try:
            gesture_model = joblib.load(model_path)
            loaded_model_path = model_path
            print(f"✅ GesturePredictor loaded from {model_path}")
            break
        except Exception as error:
            print(f"❌ Failed to load model {model_path}: {error}")

if gesture_model is not None:
    try:
        print(f"🔵 Model classes: {gesture_model.classes_}")
    except Exception:
        pass

print("=" * 60)
print("✅ GESTURE MODEL LOADED" if gesture_model is not None else "⚠️ GESTURE MODEL NOT LOADED")
print(f"📁 Model path: {loaded_model_path}")
try:
    print(f"🧠 Model classes: {gesture_model.classes_}")
except Exception:
    print("🧠 Model classes: unavailable")
print("=" * 60)


# ============================================================
# MODELS
# ============================================================

class LandmarksInput(BaseModel):
    landmarks: List[float]


# ============================================================
# CONNECTION MANAGER
# ============================================================

class ConnectionManager:

    def __init__(self):
        self.rooms: Dict[str, List[Dict[str, Any]]] = {}
        self.drawing_history: Dict[str, List[Dict[str, Any]]] = {}

    async def connect(
        self,
        room_id: str,
        websocket: WebSocket,
        user_id: str,
        user_name: str,
        is_creator: bool,
        livekit_identity: str = "",
    ):
        if room_id not in self.rooms:
            self.rooms[room_id] = []

        connection = {
            "websocket": websocket,
            "user_id": user_id,
            "user_name": user_name,
            "is_creator": is_creator,
            "livekit_identity": livekit_identity,
            "canvas_enabled": bool(is_creator),
            "drawing_permission_requested": False,
        }

        self.rooms[room_id].append(connection)
        self.drawing_history.setdefault(room_id, [])

        print(
            f"✅ CONNECTED | Room={room_id} | "
            f"Name={user_name} | ID={user_id} | "
            f"Creator={is_creator} | LiveKit={livekit_identity}"
        )

    def disconnect(self, room_id: str, websocket: WebSocket):
        connections = self.rooms.get(room_id)
        if not connections:
            return None

        removed = None
        remaining = []

        for connection in connections:
            if connection["websocket"] is websocket:
                removed = connection
            else:
                remaining.append(connection)

        if remaining:
            self.rooms[room_id] = remaining
        else:
            self.rooms.pop(room_id, None)
            self.drawing_history.pop(room_id, None)

        if removed:
            print(
                f"👋 DISCONNECTED | Room={room_id} | "
                f"Name={removed['user_name']} | ID={removed['user_id']}"
            )

        return removed

    def get_connections(self, room_id: str):
        return self.rooms.get(room_id, [])

    def get_connection(self, room_id: str, user_id: str):
        for connection in self.rooms.get(room_id, []):
            if connection["user_id"] == user_id:
                return connection
        return None

    def get_creator(self, room_id: str):
        for connection in self.rooms.get(room_id, []):
            if connection["is_creator"]:
                return connection
        return None

    def active_guest_drawers(self, room_id: str):
        return sum(
            1
            for connection in self.rooms.get(room_id, [])
            if not connection["is_creator"]
            and connection.get("canvas_enabled", False)
        )

    def participant_snapshot(self, room_id: str):
        result = []
        for connection in self.rooms.get(room_id, []):
            result.append({
                "user_id": connection["user_id"],
                "user_name": connection["user_name"],
                "is_creator": connection["is_creator"],
                "livekit_identity": connection.get("livekit_identity", ""),
                "canvas_enabled": connection.get("canvas_enabled", False),
                "drawing_permission_requested": connection.get(
                    "drawing_permission_requested", False
                ),
            })
        return result

    async def send_to_user(self, room_id: str, user_id: str, message: dict):
        connection = self.get_connection(room_id, user_id)
        if connection is None:
            return False

        try:
            await connection["websocket"].send_json(message)
            return True
        except Exception as error:
            print(f"❌ Error sending to {user_id}: {error}")
            return False

    async def broadcast(
        self,
        room_id: str,
        message: dict,
        exclude_websocket: Optional[WebSocket] = None,
    ):
        connections = list(self.rooms.get(room_id, []))

        for connection in connections:
            websocket = connection["websocket"]
            if websocket is exclude_websocket:
                continue

            try:
                await websocket.send_json(message)
            except Exception as error:
                print(
                    f"❌ Broadcast error for "
                    f"{connection['user_name']}: {error}"
                )

    async def sync_participants(self, room_id: str):
        payload = {
            "type": "room_participants",
            "participants": self.participant_snapshot(room_id),
        }
        await self.broadcast(room_id, payload)


manager = ConnectionManager()


# ============================================================
# ROOT
# ============================================================

@app.get("/")
async def root():
    classes = []
    if gesture_model is not None and hasattr(gesture_model, "classes_"):
        classes = [str(item) for item in gesture_model.classes_]

    return {
        "message": "Air Canvas Backend Running",
        "model_loaded": gesture_model is not None,
        "model_path": loaded_model_path,
        "classes": classes,
        "websocket": "/ws/{room_id}",
        "max_participants": MAX_PARTICIPANTS,
        "max_guest_drawers": MAX_GUEST_DRAWERS,
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": gesture_model is not None,
    }


# ============================================================
# GESTURE PREDICTION
# ============================================================

@app.post("/predict")
async def predict_gesture(data: LandmarksInput):
    if gesture_model is None:
        return {
            "raw_gesture": "no_gesture",
            "confirmed_gesture": "no_gesture",
            "confidence": 0.0,
            "error": "gesture_knn.joblib not loaded",
        }

    if len(data.landmarks) < 42:
        return {
            "raw_gesture": "no_gesture",
            "confirmed_gesture": "no_gesture",
            "confidence": 0.0,
        }

    try:
        features = np.array(
            data.landmarks,
            dtype=np.float32,
        ).reshape(1, -1)

        prediction = gesture_model.predict(features)
        predicted_class = str(prediction[0]).strip().lower()

        confidence = 0.0
        if hasattr(gesture_model, "predict_proba"):
            probabilities = gesture_model.predict_proba(features)[0]
            confidence = float(np.max(probabilities))

        gesture_aliases = {
            "none": "no_gesture",
            "no gesture": "no_gesture",
            "no_gesture": "no_gesture",
            "nogesture": "no_gesture",
            "draw": "draw",
            "erase": "erase",
            "clear": "clear",
        }

        confirmed_gesture = gesture_aliases.get(
            predicted_class,
            predicted_class,
        )

        result = {
            "raw_gesture": predicted_class,
            "confirmed_gesture": confirmed_gesture,
            "confidence": confidence,
        }

        print(
            f"🖐️ Gesture: {confirmed_gesture} "
            f"({confidence * 100:.1f}%)"
        )

        return result

    except Exception as error:
        print(f"❌ Prediction error: {error}")
        return {
            "raw_gesture": "no_gesture",
            "confirmed_gesture": "no_gesture",
            "confidence": 0.0,
            "error": str(error),
        }


# ============================================================
# WEBSOCKET
# ============================================================

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    user_id = str(uuid.uuid4())[:8]
    user_name = "User"
    is_creator = False
    livekit_identity = ""

    try:
        # IMPORTANT: ACCEPT FIRST.
        # FastAPI must accept the WebSocket before receive_json() or send_json().
        await websocket.accept()

        print(f"🔌 WebSocket accepted | Room={room_id}")

        # --------------------------------------------------------
        # REGISTRATION
        # --------------------------------------------------------

        try:
            first_message = await websocket.receive_json()

            message_type = first_message.get(
                "type",
                "join_meeting",
            )

            user_name = str(
                first_message.get("user_name") or "User"
            ).strip()[:30] or "User"

            livekit_identity = str(
                first_message.get("livekit_identity") or ""
            ).strip()

            incoming_user_id = first_message.get("user_id")
            if incoming_user_id:
                user_id = str(incoming_user_id)[:64]

            print(
                f"📩 REGISTRATION | Room={room_id} | "
                f"Type={message_type} | Name={user_name} | "
                f"ID={user_id} | LiveKit={livekit_identity}"
            )

        except Exception as error:
            print(f"❌ Registration error: {error}")
            await websocket.send_json({
                "type": "error",
                "message": "Invalid meeting registration.",
            })
            await websocket.close()
            return

        # --------------------------------------------------------
        # HOST / PARTICIPANT
        # --------------------------------------------------------

        if message_type == "create_meeting":
            is_creator = True
        elif message_type == "join_meeting":
            is_creator = False
        else:
            await websocket.send_json({
                "type": "error",
                "message": "Invalid first WebSocket message.",
            })
            await websocket.close()
            return

        # --------------------------------------------------------
        # ROOM LIMIT
        # --------------------------------------------------------

        current = manager.get_connections(room_id)

        if len(current) >= MAX_PARTICIPANTS:
            await websocket.send_json({
                "type": "room_full",
                "message": (
                    f"Meeting is full. Maximum "
                    f"{MAX_PARTICIPANTS} participants."
                ),
            })
            await websocket.close()
            return

        # --------------------------------------------------------
        # ONE HOST
        # --------------------------------------------------------

        if is_creator and manager.get_creator(room_id) is not None:
            await websocket.send_json({
                "type": "error",
                "message": "Meeting already has a host.",
            })
            await websocket.close()
            return

        # --------------------------------------------------------
        # HANDLE RECONNECT / DUPLICATE USER ID
        # --------------------------------------------------------

        existing_connection = manager.get_connection(
            room_id,
            user_id,
        )

        if existing_connection is not None:
            old_websocket = existing_connection["websocket"]

            print(
                f"🔄 RECONNECT | Replacing old connection | "
                f"Room={room_id} | Name={user_name} | ID={user_id}"
            )

            manager.disconnect(
                room_id,
                old_websocket,
            )

            try:
                await old_websocket.close()
            except Exception:
                pass

        # --------------------------------------------------------
        # REGISTER
        # --------------------------------------------------------

        await manager.connect(
            room_id=room_id,
            websocket=websocket,
            user_id=user_id,
            user_name=user_name,
            is_creator=is_creator,
            livekit_identity=livekit_identity,
        )

        # --------------------------------------------------------
        # SELF INFO
        # --------------------------------------------------------

        await websocket.send_json({
            "type": "self_info",
            "user_id": user_id,
            "user_name": user_name,
            "is_creator": is_creator,
            "livekit_identity": livekit_identity,
            "canvas_enabled": is_creator,
        })

        # --------------------------------------------------------
        # PARTICIPANT SNAPSHOT
        # --------------------------------------------------------

        await websocket.send_json({
            "type": "room_participants",
            "participants": manager.participant_snapshot(room_id),
        })

        if is_creator:
            print(
                f"👑 HOST CREATED | {user_name} | Room={room_id}"
            )
        else:
            print(
                f"👤 PARTICIPANT JOINED | {user_name} | Room={room_id}"
            )

            creator = manager.get_creator(room_id)

            if creator:
                await websocket.send_json({
                    "type": "creator_info",
                    "creator_id": creator["user_id"],
                    "creator_name": creator["user_name"],
                    "creator_livekit_identity": creator.get(
                        "livekit_identity", ""
                    ),
                })

            await manager.broadcast(
                room_id,
                {
                    "type": "participant_joined",
                    "user_id": user_id,
                    "user_name": user_name,
                    "is_creator": False,
                    "livekit_identity": livekit_identity,
                    "canvas_enabled": False,
                },
                exclude_websocket=websocket,
            )

            # Send existing canvas to the newly joined participant.
            history = manager.drawing_history.get(room_id, [])
            if history:
                await websocket.send_json({
                    "type": "drawing_history",
                    "events": history,
                })

        # Keep every client synchronized after registration.
        await manager.sync_participants(room_id)

        # ========================================================
        # MAIN LOOP
        # ========================================================

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # ----------------------------------------------------
            # CHAT
            # ----------------------------------------------------

            if msg_type == "chat_message":
                text = str(
                    data.get("message")
                    or data.get("text")
                    or ""
                ).strip()

                if not text:
                    continue

                message = {
                    "type": "chat_message",
                    "user_id": user_id,
                    "user_name": user_name,
                    "livekit_identity": livekit_identity,
                    "message": text[:2000],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

                print(f"💬 CHAT | {user_name}: {text[:80]}")

                # Include sender so their own message is rendered too.
                await manager.broadcast(room_id, message)

            # ----------------------------------------------------
            # REQUEST DRAWING
            # ----------------------------------------------------

            elif msg_type == "request_drawing":
                if is_creator:
                    await websocket.send_json({
                        "type": "drawing_permission_denied",
                        "message": "The host already has drawing permission.",
                    })
                    continue

                connection = manager.get_connection(room_id, user_id)
                if connection:
                    connection["drawing_permission_requested"] = True

                creator = manager.get_creator(room_id)

                if creator:
                    print(
                        f"🙋 DRAW REQUEST | {user_name} -> host"
                    )

                    await manager.send_to_user(
                        room_id,
                        creator["user_id"],
                        {
                            "type": "drawing_permission_request",
                            "user_id": user_id,
                            "user_name": user_name,
                            "livekit_identity": livekit_identity,
                        },
                    )

                    await manager.sync_participants(room_id)

                else:
                    await websocket.send_json({
                        "type": "drawing_permission_denied",
                        "message": "Host is not connected.",
                    })

            # ----------------------------------------------------
            # GRANT DRAWING
            # ----------------------------------------------------

            elif msg_type == "grant_drawing":
                if not is_creator:
                    continue

                target_id = str(
                    data.get("target_user_id")
                    or data.get("user_id")
                    or ""
                )

                target = manager.get_connection(
                    room_id,
                    target_id,
                )

                if not target:
                    await websocket.send_json({
                        "type": "drawing_permission_denied",
                        "user_id": target_id,
                        "message": "Participant is no longer connected.",
                    })
                    continue

                if (
                    not target["is_creator"]
                    and not target.get("canvas_enabled", False)
                    and manager.active_guest_drawers(room_id)
                    >= MAX_GUEST_DRAWERS
                ):
                    await websocket.send_json({
                        "type": "drawing_permission_denied",
                        "user_id": target_id,
                        "message": (
                            f"Only {MAX_GUEST_DRAWERS} guest participants "
                            "can draw at once."
                        ),
                    })
                    continue

                target["canvas_enabled"] = True
                target["drawing_permission_requested"] = False

                payload = {
                    "type": "drawing_permission",
                    "user_id": target["user_id"],
                    "user_name": target["user_name"],
                    "livekit_identity": target.get(
                        "livekit_identity", ""
                    ),
                    "canvas_enabled": True,
                }

                print(
                    f"🎨 GRANT DRAWING | {target['user_name']}"
                )

                await manager.broadcast(room_id, payload)
                await manager.sync_participants(room_id)

            # ----------------------------------------------------
            # REVOKE DRAWING
            # ----------------------------------------------------

            elif msg_type == "revoke_drawing":
                if not is_creator:
                    continue

                target_id = str(
                    data.get("target_user_id")
                    or data.get("user_id")
                    or ""
                )

                target = manager.get_connection(
                    room_id,
                    target_id,
                )

                if not target:
                    continue

                target["canvas_enabled"] = False
                target["drawing_permission_requested"] = False

                await manager.broadcast(
                    room_id,
                    {
                        "type": "drawing_permission",
                        "user_id": target["user_id"],
                        "user_name": target["user_name"],
                        "livekit_identity": target.get(
                            "livekit_identity", ""
                        ),
                        "canvas_enabled": False,
                    },
                )

                await manager.sync_participants(room_id)

            # ----------------------------------------------------
            # DRAW DATA
            # ----------------------------------------------------

            elif msg_type == "draw_data":
                connection = manager.get_connection(
                    room_id,
                    user_id,
                )

                # Host can always draw. Guests need permission.
                if not is_creator and not (
                    connection
                    and connection.get("canvas_enabled", False)
                ):
                    continue

                draw_message = {
                    "type": "draw_data",
                    "user_id": user_id,
                    "user_name": user_name,
                    "livekit_identity": livekit_identity,
                    "action": data.get("action", "draw"),
                    "x": data.get("x", 0),
                    "y": data.get("y", 0),
                    "lastX": data.get(
                        "lastX",
                        data.get("prev_x", 0),
                    ),
                    "lastY": data.get(
                        "lastY",
                        data.get("prev_y", 0),
                    ),
                    "prev_x": data.get(
                        "prev_x",
                        data.get("lastX", 0),
                    ),
                    "prev_y": data.get(
                        "prev_y",
                        data.get("lastY", 0),
                    ),
                    "color": data.get("color", "#00ff00"),
                    "lineWidth": data.get("lineWidth", 3),
                }

                history = manager.drawing_history.setdefault(
                    room_id,
                    [],
                )
                history.append(draw_message)

                if len(history) > MAX_DRAWING_HISTORY:
                    manager.drawing_history[room_id] = history[
                        -MAX_DRAWING_HISTORY:
                    ]

                await manager.broadcast(
                    room_id,
                    draw_message,
                    exclude_websocket=websocket,
                )

            # ----------------------------------------------------
            # CLEAR CANVAS
            # ----------------------------------------------------

            elif msg_type == "clear_canvas":
                connection = manager.get_connection(
                    room_id,
                    user_id,
                )

                if not is_creator and not (
                    connection
                    and connection.get("canvas_enabled", False)
                ):
                    continue

                manager.drawing_history[room_id] = []

                await manager.broadcast(
                    room_id,
                    {
                        "type": "clear_canvas",
                        "user_id": user_id,
                        "user_name": user_name,
                        "livekit_identity": livekit_identity,
                    },
                    exclude_websocket=websocket,
                )

            # ----------------------------------------------------
            # LEGACY WEBRTC SIGNALING
            # ----------------------------------------------------

            elif msg_type in {
                "offer",
                "answer",
                "ice-candidate",
            }:
                outgoing = dict(data)
                outgoing["from"] = user_id
                outgoing["from_name"] = user_name
                outgoing["livekit_identity"] = livekit_identity

                await manager.broadcast(
                    room_id,
                    outgoing,
                    exclude_websocket=websocket,
                )

            # ----------------------------------------------------
            # LEAVE
            # ----------------------------------------------------

            elif msg_type == "leave_meeting":
                removed = manager.disconnect(
                    room_id,
                    websocket,
                )

                if removed:
                    await manager.broadcast(
                        room_id,
                        {
                            "type": "participant_left",
                            "user_id": removed["user_id"],
                            "user_name": removed["user_name"],
                            "livekit_identity": removed.get(
                                "livekit_identity", ""
                            ),
                        },
                    )
                    await manager.sync_participants(room_id)

                return

            else:
                print(
                    f"⚠️ Unknown message type: "
                    f"{msg_type} | {user_name}"
                )

    except WebSocketDisconnect:
        removed = manager.disconnect(
            room_id,
            websocket,
        )

        if removed:
            await manager.broadcast(
                room_id,
                {
                    "type": "participant_left",
                    "user_id": removed["user_id"],
                    "user_name": removed["user_name"],
                    "livekit_identity": removed.get(
                        "livekit_identity", ""
                    ),
                },
            )
            await manager.sync_participants(room_id)

    except Exception as error:
        print(
            f"❌ WebSocket error | "
            f"{user_name} | {error}"
        )

        removed = manager.disconnect(
            room_id,
            websocket,
        )

        if removed:
            try:
                await manager.broadcast(
                    room_id,
                    {
                        "type": "participant_left",
                        "user_id": removed["user_id"],
                        "user_name": removed["user_name"],
                        "livekit_identity": removed.get(
                            "livekit_identity", ""
                        ),
                    },
                )
                await manager.sync_participants(room_id)
            except Exception:
                pass


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
        reload=False,
    )

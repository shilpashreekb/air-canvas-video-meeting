# backend/app/websocket/routes.py

import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set, Optional
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

# Store all active connections
class ConnectionManager:
    def __init__(self):
        # room_id -> { user_id: websocket }
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        self.room_participants: Dict[str, Set[str]] = {}
    
    async def connect(self, websocket: WebSocket, room_id: str, user_id: str):
        await websocket.accept()
        
        if room_id not in self.active_connections:
            self.active_connections[room_id] = {}
            self.room_participants[room_id] = set()
        
        self.active_connections[room_id][user_id] = websocket
        self.room_participants[room_id].add(user_id)
        
        logger.info(f"User {user_id} joined room {room_id}")
        
        # Send current participant list to new user
        participants = list(self.room_participants[room_id])
        await websocket.send_json({
            "type": "joined",
            "role": "host" if len(participants) == 1 else "guest",
            "participants": participants,
            "participant_count": len(participants),
            "user_id": user_id
        })
        
        # Broadcast to others
        await self.broadcast_to_room(room_id, {
            "type": "participant_joined",
            "user_id": user_id
        }, exclude=user_id)
        
        await self.broadcast_participants(room_id)
    
    async def disconnect(self, room_id: str, user_id: str):
        if room_id in self.active_connections:
            self.active_connections[room_id].pop(user_id, None)
            self.room_participants[room_id].discard(user_id)
            
            logger.info(f"User {user_id} left room {room_id}")
            
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
                del self.room_participants[room_id]
            else:
                await self.broadcast_to_room(room_id, {
                    "type": "participant_left",
                    "user_id": user_id
                })
                await self.broadcast_participants(room_id)
    
    async def broadcast_to_room(self, room_id: str, message: dict, exclude: Optional[str] = None):
        if room_id not in self.active_connections:
            return
        
        message_json = json.dumps(message)
        for user_id, websocket in self.active_connections[room_id].items():
            if user_id != exclude:
                try:
                    await websocket.send_text(message_json)
                except Exception as e:
                    logger.error(f"Broadcast error to {user_id}: {e}")
    
    async def send_to_user(self, room_id: str, target_user_id: str, message: dict):
        if room_id in self.active_connections:
            websocket = self.active_connections[room_id].get(target_user_id)
            if websocket:
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.error(f"Send to {target_user_id} error: {e}")
    
    async def broadcast_participants(self, room_id: str):
        if room_id in self.active_connections:
            participants = list(self.room_participants.get(room_id, []))
            await self.broadcast_to_room(room_id, {
                "type": "participants",
                "participants": participants
            })

manager = ConnectionManager()

# ============================================================
# WEBSOCKET ENDPOINT — MATCHES FRONTEND URL
# ============================================================

@router.websocket("/ws/meeting/{room_id}/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    user_id: str
):
    await manager.connect(websocket, room_id, user_id)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            message_type = message.get("type")
            
            if message_type == "offer":
                target = message.get("target")
                if target:
                    await manager.send_to_user(room_id, target, {
                        "type": "offer",
                        "offer": message.get("offer"),
                        "from": user_id
                    })
            
            elif message_type == "answer":
                target = message.get("target")
                if target:
                    await manager.send_to_user(room_id, target, {
                        "type": "answer",
                        "answer": message.get("answer"),
                        "from": user_id
                    })
            
            elif message_type == "ice_candidate":
                target = message.get("target")
                if target:
                    await manager.send_to_user(room_id, target, {
                        "type": "ice_candidate",
                        "candidate": message.get("candidate"),
                        "from": user_id
                    })
            
            elif message_type == "canvas":
                # Broadcast canvas to ALL participants
                await manager.broadcast_to_room(room_id, {
                    "type": "canvas",
                    "action": message.get("action"),
                    "from": user_id,
                    "data": message.get("data", {})
                })
            
            elif message_type == "leave":
                await manager.disconnect(room_id, user_id)
                break
    
    except WebSocketDisconnect:
        await manager.disconnect(room_id, user_id)
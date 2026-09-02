# backend/app/meetings/manager.py

import secrets
import string
from typing import Dict, Set, Optional, List, Any
from datetime import datetime
from sqlalchemy.orm import Session

from ..database import MeetingRoom, User


class MeetingManager:
    _active_participants: Dict[str, Set[int]] = {}
    _room_connections: Dict[str, Dict[int, Any]] = {}
    
    @classmethod
    def generate_room_id(cls, length: int = 8) -> str:
        alphabet = string.ascii_uppercase + string.digits
        alphabet = alphabet.replace('O', '').replace('I', '').replace('0', '').replace('1', '')
        
        part1 = ''.join(secrets.choice(alphabet) for _ in range(3))
        part2 = ''.join(secrets.choice(alphabet) for _ in range(3))
        part3 = ''.join(secrets.choice(alphabet) for _ in range(3))
        
        return f"{part1}-{part2}-{part3}"
    
    @classmethod
    def create_room(cls, db: Session, user_id: int, metadata: Optional[Dict[str, Any]] = None) -> MeetingRoom:
        room_id = cls.generate_room_id()
        
        while db.query(MeetingRoom).filter(MeetingRoom.room_id == room_id).first():
            room_id = cls.generate_room_id()
        
        room = MeetingRoom(
            room_id=room_id,
            created_by=user_id,
            metadata=metadata if metadata else "{}"
        )
        
        db.add(room)
        db.commit()
        db.refresh(room)
        
        return room
    
    @classmethod
    def get_room(cls, db: Session, room_id: str) -> Optional[MeetingRoom]:
        return db.query(MeetingRoom).filter(
            MeetingRoom.room_id == room_id,
            MeetingRoom.is_active == True
        ).first()
    
    @classmethod
    def close_room(cls, db: Session, room_id: str, user_id: int) -> bool:
        room = db.query(MeetingRoom).filter(
            MeetingRoom.room_id == room_id,
            MeetingRoom.is_active == True
        ).first()
        
        if not room or room.created_by != user_id:
            return False
        
        room.is_active = False
        db.commit()
        
        if room_id in cls._active_participants:
            del cls._active_participants[room_id]
        if room_id in cls._room_connections:
            del cls._room_connections[room_id]
        
        return True
    
    @classmethod
    def add_participant(cls, room_id: str, user_id: int, websocket: Any = None) -> None:
        if room_id not in cls._active_participants:
            cls._active_participants[room_id] = set()
            cls._room_connections[room_id] = {}
        
        cls._active_participants[room_id].add(user_id)
        if websocket:
            cls._room_connections[room_id][user_id] = websocket
    
    @classmethod
    def remove_participant(cls, room_id: str, user_id: int) -> None:
        if room_id in cls._active_participants:
            cls._active_participants[room_id].discard(user_id)
            if not cls._active_participants[room_id]:
                del cls._active_participants[room_id]
        
        if room_id in cls._room_connections:
            cls._room_connections[room_id].pop(user_id, None)
            if not cls._room_connections[room_id]:
                del cls._room_connections[room_id]
    
    @classmethod
    def get_participants(cls, room_id: str) -> Set[int]:
        return cls._active_participants.get(room_id, set())
    
    @classmethod
    def get_participant_count(cls, room_id: str) -> int:
        return len(cls._active_participants.get(room_id, set()))
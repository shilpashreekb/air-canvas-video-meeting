# backend/app/meetings/schemas.py

from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime


class MeetingCreate(BaseModel):
    metadata: Optional[Dict[str, Any]] = None


class MeetingJoin(BaseModel):
    room_id: str


class MeetingClose(BaseModel):
    room_id: str


class MeetingResponse(BaseModel):
    id: int
    room_id: str
    created_by: int
    created_at: datetime
    is_active: bool
    metadata: Optional[Dict[str, Any]] = None
    participant_count: int = 0
    
    class Config:
        from_attributes = True


class MeetingParticipant(BaseModel):
    user_id: int
    username: str


class MeetingInfoResponse(BaseModel):
    room_id: str
    created_by: int
    created_at: datetime
    is_active: bool
    participants: List[MeetingParticipant]
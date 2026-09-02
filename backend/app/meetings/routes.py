# backend/app/meetings/routes.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from ..database import get_db, User, MeetingRoom
from ..auth.security import get_current_user
from .schemas import MeetingCreate, MeetingResponse, MeetingInfoResponse, MeetingParticipant
from .manager import MeetingManager

router = APIRouter(prefix="/api/meetings", tags=["Meetings"])


@router.post("/create", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    meeting_data: MeetingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> MeetingResponse:
    room = MeetingManager.create_room(
        db=db,
        user_id=current_user.id,
        metadata=meeting_data.metadata
    )
    
    return MeetingResponse(
        id=room.id,
        room_id=room.room_id,
        created_by=room.created_by,
        created_at=room.created_at,
        is_active=room.is_active,
        metadata=room.metadata,
        participant_count=0
    )


@router.post("/join/{room_id}", response_model=MeetingInfoResponse)
async def join_meeting(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> MeetingInfoResponse:
    room = MeetingManager.get_room(db=db, room_id=room_id)
    
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting room not found or has been closed"
        )
    
    participants = MeetingManager.get_participants(room_id)
    participant_list = []
    
    if participants:
        users = db.query(User).filter(User.id.in_(participants)).all()
        user_map = {user.id: user.username for user in users}
        
        for user_id in participants:
            participant_list.append(
                MeetingParticipant(
                    user_id=user_id,
                    username=user_map.get(user_id, "Unknown")
                )
            )
    
    return MeetingInfoResponse(
        room_id=room.room_id,
        created_by=room.created_by,
        created_at=room.created_at,
        is_active=room.is_active,
        participants=participant_list
    )


@router.get("/{room_id}", response_model=MeetingInfoResponse)
async def get_meeting_info(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> MeetingInfoResponse:
    room = MeetingManager.get_room(db=db, room_id=room_id)
    
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting room not found or has been closed"
        )
    
    participants = MeetingManager.get_participants(room_id)
    participant_list = []
    
    if participants:
        users = db.query(User).filter(User.id.in_(participants)).all()
        user_map = {user.id: user.username for user in users}
        
        for user_id in participants:
            participant_list.append(
                MeetingParticipant(
                    user_id=user_id,
                    username=user_map.get(user_id, "Unknown")
                )
            )
    
    return MeetingInfoResponse(
        room_id=room.room_id,
        created_by=room.created_by,
        created_at=room.created_at,
        is_active=room.is_active,
        participants=participant_list
    )


@router.post("/{room_id}/close")
async def close_meeting(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    success = MeetingManager.close_room(db=db, room_id=room_id, user_id=current_user.id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not close room. Either room not found or you are not the creator."
        )
    
    return {"message": "Meeting room closed successfully"}


@router.get("/active", response_model=List[MeetingResponse])
async def get_active_meetings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> List[MeetingResponse]:
    rooms = db.query(MeetingRoom).filter(MeetingRoom.is_active == True).all()
    
    result = []
    for room in rooms:
        participant_count = MeetingManager.get_participant_count(room.room_id)
        result.append(
            MeetingResponse(
                id=room.id,
                room_id=room.room_id,
                created_by=room.created_by,
                created_at=room.created_at,
                is_active=room.is_active,
                metadata=room.metadata,
                participant_count=participant_count
            )
        )
    
    return result
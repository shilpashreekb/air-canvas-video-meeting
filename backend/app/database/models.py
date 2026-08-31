"""
SQLAlchemy ORM models.

Schema (finalized in Phase 1):

users
    id, username, email, password_hash, created_at

meeting_rooms
    id, room_id, created_by, created_at

drawing_actions
    id, room_id, user_id, action_type, x, y, timestamp, metadata
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _generate_room_code() -> str:
    """Generate a short, URL-friendly meeting room code."""
    return uuid.uuid4().hex[:8]


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    meeting_rooms = relationship(
        "MeetingRoom", back_populates="creator", cascade="all, delete-orphan"
    )
    drawing_actions = relationship(
        "DrawingAction", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"


class MeetingRoom(Base):
    __tablename__ = "meeting_rooms"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(
        String(32), unique=True, nullable=False, index=True, default=_generate_room_code
    )
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    creator = relationship("User", back_populates="meeting_rooms")
    drawing_actions = relationship(
        "DrawingAction", back_populates="room", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<MeetingRoom id={self.id} room_id={self.room_id!r}>"


class DrawingAction(Base):
    __tablename__ = "drawing_actions"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(
        String(32), ForeignKey("meeting_rooms.room_id"), nullable=False, index=True
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action_type = Column(String(20), nullable=False)  # start_draw, draw_point, end_draw, erase, clear
    x = Column(Float, nullable=True)
    y = Column(Float, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    action_metadata = Column(String(255), nullable=True)  # e.g. JSON string: brush size, color

    room = relationship("MeetingRoom", back_populates="drawing_actions")
    user = relationship("User", back_populates="drawing_actions")

    def __repr__(self) -> str:
        return (
            f"<DrawingAction id={self.id} room_id={self.room_id!r} "
            f"action_type={self.action_type!r}>"
        )

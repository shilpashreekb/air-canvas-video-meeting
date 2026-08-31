"""
SQLAlchemy engine / session setup for the SQLite database.

This module is intentionally framework-agnostic beyond SQLAlchemy itself so
it can be imported by the FastAPI app, by standalone scripts (e.g. dataset
tooling), and by tests without pulling in unrelated dependencies.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

# SQLite requires this connect_arg when accessed from multiple threads,
# which happens routinely under uvicorn's threaded request handling.
connect_args = (
    {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
)

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """
    FastAPI dependency that yields a database session and guarantees it is
    closed after the request completes, even if an exception is raised.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Create all tables that don't already exist.

    Called once at application startup. Safe to call repeatedly — SQLAlchemy
    only creates tables that are missing.
    """
    # Import models here (not at module top-level) so that all model classes
    # are registered on Base.metadata before create_all() runs, without
    # creating a circular import between database.py and models.py.
    from app.database import models  # noqa: F401

    Base.metadata.create_all(bind=engine)

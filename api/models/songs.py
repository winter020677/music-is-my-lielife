"""SQLAlchemy ORM model for the songs table."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Song(Base):
    __tablename__ = "songs"

    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    artist = Column(String, nullable=False)
    listened_at = Column(DateTime)
    mood = Column(String)
    favorite_part = Column(String, nullable=True)
    # Times are stored in UTC for frontend conversion.
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

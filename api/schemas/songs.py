from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SongSchema(BaseModel):
    title: str
    artist: str
    listened_at: datetime
    mood: Optional[str] = None
    favorite_part: Optional[str] = None

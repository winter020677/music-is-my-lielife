from collections import Counter

from database import get_db
from fastapi import APIRouter, Depends
from models.songs import Song
from schemas.songs import SongSchema
from services.spotify import get_recommendations, get_track_features
from sqlalchemy.orm import Session

router = APIRouter()


@router.post("/songs/log")
def log_song(song: SongSchema, db: Session = Depends(get_db)):
    """post input song log"""
    db_song = Song(
        title=song.title,
        artist=song.artist,
        listened_at=song.listened_at,
        mood=song.mood,
        favorite_part=song.favorite_part,
    )
    db.add(db_song)
    db.commit()
    db.refresh(db_song)
    return db_song


@router.get("/songs")
def get_songs(db: Session = Depends(get_db)):
    """get song log data from db"""
    songs = db.query(Song).all()
    return songs


@router.get("/songs/features")
def get_features(title: str, artist: str):
    """get track metadata from spotify"""
    features = get_track_features(title, artist)
    return {"features": features}


@router.get("/songs/recommend")
def recommend_songs(title: str, artist: str, limit: int = 5):
    """return song recommendations based on genre"""
    recs = get_recommendations(title, artist, limit)
    if recs is None:
        return {"error": "song not found"}
    return {"recommendations": recs}


@router.get("/songs/analysis")
def analysis_songs(db: Session = Depends(get_db)):
    songs = db.query(Song).all()
    moods = [song.mood for song in songs if song.mood]
    counts = Counter(moods)
    return {"mood_analysis": counts.most_common()}

from collections import Counter

from database import get_db
from fastapi import APIRouter, Depends, HTTPException
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
        raise HTTPException(status_code=404, detail="song not found")
    return {"recommendations": recs}


@router.get("/songs/analysis")
def analysis_songs(db: Session = Depends(get_db)):
    songs = db.query(Song).all()
    moods = [song.mood for song in songs if song.mood]
    counts = Counter(moods)
    return {"mood_analysis": counts.most_common()}


@router.delete("/songs/{song_id}")
def delete_song(song_id: int, db: Session = Depends(get_db)):
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="song not found")
    db.delete(song)
    db.commit()
    return {"ok": True}


@router.get("/songs/mood-trend")
def mood_trend(db: Session = Depends(get_db)):
    songs = db.query(Song).all()
    MOOD_GROUPS = {
        "positive": ["happy", "calm"],
        "negative": ["sad", "tired"],
        "neutral": ["neutral"],
    }
    result = []
    for song in songs:
        if not song.mood:
            continue
        group = "neutral"
        for g, moods in MOOD_GROUPS.items():
            if song.mood in moods:
                group = g
                break
        result.append(
            {
                "listened_at": song.listened_at,
                "group": group,
            }
        )
    return {"trend": result}

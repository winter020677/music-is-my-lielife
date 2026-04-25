"""connecting for spotify api"""

import json
import os

import spotipy
from services.cache import r
from spotipy.oauth2 import SpotifyClientCredentials

# credentials loaded from env vars to avoid hardcoding secrets
sp = spotipy.Spotify(
    auth_manager=SpotifyClientCredentials(
        client_id=os.getenv("SPOTIFY_CLIENT_ID"),
        client_secret=os.getenv("SPOTIFY_CLIENT_SECRET"),
    )
)


def get_track_features(title: str, artist: str):
    key = f"features:{title}:{artist}"  # create a unique key for each track
    cached = r.get(key)  # check Redis cache
    if cached:
        return json.loads(cached)
    # cache miss: fetch from Spotify API
    results = sp.search(q=f"track:{title} artist:{artist}", type="track", limit=1)

    tracks = results["tracks"]["items"]
    if not tracks:
        return None
    track_id = tracks[0]["id"]
    track = sp.track(track_id)
    artist_id = track["artists"][0]["id"]
    artist_info = sp.artist(artist_id)

    result = {
        "title": track["name"],
        "artist": track["artists"][0]["name"],
        "album": track["album"]["name"],
        "popularity": track.get("popularity"),
        "duration_ms": track["duration_ms"],
        "genres": artist_info.get("genres", []),
    }
    r.set(key, json.dumps(result), ex=3600)  # cache result for 1 hour (ex=3600s)
    return result


def get_recommendations(title: str, artist: str, limit: int = 5):
    results = sp.search(q=f"track:{title} artist:{artist}", type="track", limit=1)
    tracks = results["tracks"]["items"]
    if not tracks:
        return None

    artist_id = tracks[0]["artists"][0]["id"]
    artist_info = sp.artist(artist_id)
    genres = artist_info.get("genres", [])

    if not genres:
        search_results = sp.search(q=f"artist:{artist}", type="track", limit=limit + 5)
    else:
        genre_query = genres[0]
        search_results = sp.search(
            q=f"genre:{genre_query}", type="track", limit=limit + 5
        )

    found_tracks = search_results["tracks"]["items"]

    recs = []
    for t in found_tracks:
        if t["artists"][0]["name"].lower() != artist.lower():
            recs.append(
                {
                    "title": t["name"],
                    "artist": t["artists"][0]["name"],
                    "album": t["album"]["name"],
                    "spotify_url": t["external_urls"]["spotify"],
                }
            )
        if len(recs) >= limit:
            break

    return recs

import os

import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

sp = spotipy.Spotify(
    auth_manager=SpotifyClientCredentials(
        client_id=os.getenv("SPOTIFY_CLIENT_ID"),
        client_secret=os.getenv("SPOTIFY_CLIENT_SECRET"),
    )
)


def get_track_features(title: str, artist: str):
    results = sp.search(q=f"track:{title} artist:{artist}", type="track", limit=1)

    tracks = results["tracks"]["items"]
    if not tracks:
        return None
    track = sp.track(tracks[0]["id"])
    artist_id = track["artists"][0]["id"]
    artist_info = sp.artist(artist_id)

    return {
        "title": track["name"],
        "artist": track["artists"][0]["name"],
        "album": track["album"]["name"],
        "popularity": track["popularity"],
        "duration_ms": track["duration_ms"],
        "genres": artist_info["genres"],
    }

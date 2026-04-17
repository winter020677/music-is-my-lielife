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
    track_id = tracks[0]["id"]
    track = sp.track(track_id)
    artist_id = track["artists"][0]["id"]
    artist = sp.artist(artist_id)

    return {
        "title": track["name"],
        "artist": track["artists"][0]["name"],
        "album": track["album"]["name"],
        "popularity": track["popularity"],
        "duration_ms": track["duration_ms"],
        "genres": artist["genres"],
    }


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

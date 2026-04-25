def test_log_song(client):
    res = client.post(
        "/songs/log",
        json={
            "title": "Bohemian Rhapsody",
            "artist": "Queen",
            "listened_at": "2026-04-25T00:00:00",
            "mood": "happy",
            "favorite_part": "",
        },
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Bohemian Rhapsody"


def test_log_song_missing_field(client):
    res = client.post(
        "/songs/log",
        json={
            "artist": "Queen",
        },
    )
    assert res.status_code == 422

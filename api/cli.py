import argparse
from datetime import datetime

import requests

parser = argparse.ArgumentParser(description="Music is my lielife CLI")
subparsers = parser.add_subparsers(dest="command")

log_parser = subparsers.add_parser("log")
log_parser.add_argument("title")
log_parser.add_argument("artist")
log_parser.add_argument("--mood", default="")
log_parser.add_argument("--listened_at", default=datetime.now().isoformat())

subparsers.add_parser("list")
subparsers.add_parser("analysis")

args = parser.parse_args()

BASE_URL = "http://localhost:8000"
if args.command == "log":
    res = requests.post(
        f"{BASE_URL}/songs/log",
        json={
            "title": args.title,
            "artist": args.artist,
            "mood": args.mood,
            "listened_at": args.listened_at,
            "favorite_part": "",
        },
    )
    print(res.json())

elif args.command == "list":
    res = requests.get(f"{BASE_URL}/songs")
    for song in res.json():
        print(f"{song['listened_at']} - {song['title']} / {song['artist']}")

elif args.command == "analysis":
    res = requests.get(f"{BASE_URL}/songs/analysis")
    print(res.json())

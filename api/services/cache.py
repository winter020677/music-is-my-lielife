"""Spotify API responses cache via Redis."""

import redis

# "cache" is the docker-compose service name for the Redis container
r = redis.Redis(host="cache", port=6379)

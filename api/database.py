"""Database connection setup and session management."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "postgresql://tester:tester@db/music_db"

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# By placing db.close() in a finally block, the session is guaranteed to be closed
# whether the endpoint succeeds or fails.


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

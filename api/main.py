from dotenv import load_dotenv

load_dotenv()

from database import engine
from fastapi import FastAPI
from models.songs import Base
from routes import songs

app = FastAPI()

app.include_router(songs.router)
Base.metadata.create_all(bind=engine)

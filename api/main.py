from dotenv import load_dotenv

load_dotenv()

from database import engine
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models.songs import Base
from routes import songs

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songs.router)
Base.metadata.create_all(bind=engine)

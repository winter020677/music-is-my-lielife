"""application entry point"""

from dotenv import load_dotenv

load_dotenv()

from contextlib import asynccontextmanager

from database import engine
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models.songs import Base
from routes import songs


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)

    yield


app = FastAPI(lifespan=lifespan)

origins = [
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(songs.router)

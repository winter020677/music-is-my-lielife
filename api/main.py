from database import engine
from fastapi import FastAPI
from models.songs import Base
from routes import songs

app = FastAPI()
Base.metadata.create_all(bind=engine)
app.include_router(songs.router)

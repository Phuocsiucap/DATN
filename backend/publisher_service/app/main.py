from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.publisher_service.app.api.router import router
from backend.publisher_service.app.services.worker import start_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    await start_worker()
    yield


app = FastAPI(title="Publisher Service", lifespan=lifespan)
app.include_router(router)


@app.get("/")
async def root():
    return {"status": "ok", "message": "Publisher Service running"}

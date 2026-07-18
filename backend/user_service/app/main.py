import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.user_service.app.api.router import router
from backend.user_service.app.core.database import Base, engine
from backend.user_service.app.models import user


def ensure_runtime_columns():
    statements = [
        "ALTER TABLE social_profile_strategies ADD COLUMN IF NOT EXISTS schedule_enabled BOOLEAN DEFAULT TRUE",
        "ALTER TABLE social_profile_strategies ADD COLUMN IF NOT EXISTS schedule_days VARCHAR DEFAULT '0,1,2,3,4,5,6'",
        "ALTER TABLE social_profile_strategies ADD COLUMN IF NOT EXISTS schedule_times VARCHAR DEFAULT '08:30,20:30'",
        "ALTER TABLE social_profile_strategies ADD COLUMN IF NOT EXISTS schedule_timezone VARCHAR DEFAULT 'Asia/Bangkok'",
    ]
    with engine.begin() as connection:
        for statement in statements:
            try:
                connection.exec_driver_sql(statement)
            except Exception:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ = user
    Base.metadata.create_all(bind=engine)
    ensure_runtime_columns()
    yield


app = FastAPI(title="User Service", lifespan=lifespan)

frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
async def root():
    return {"status": "ok", "message": "User Service running"}

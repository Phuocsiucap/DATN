from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from common.db.bootstrap import ensure_roles, ensure_schema_compatibility
from common.db.models import Base
from common.db.session import SessionLocal, engine
from common.http.responses import configure_api_responses
from app.api.routes import (
    admin,
    ai_management,
    analytics,
    auth,
    media_workflows,
    content_series,
    contents,
    creator_dashboard,
    crawl_jobs,
    media_proxy,
    generate_video,
    planning_runs,
    profile_planning,
    social_profiles,
    sources,
    stories,
    tiktok_shop,
    users,
)
from app.services.publish_scheduler import start_publish_queue_scheduler, stop_publish_queue_scheduler

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[api-service] Base.metadata.create_all warning: {e}")
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
        ensure_roles(db)
    await start_publish_queue_scheduler()
    yield
    await stop_publish_queue_scheduler()


app = FastAPI(title="SocialContent API Service", lifespan=lifespan)
configure_api_responses(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin-system"])

# ── OAuth callback routes (no /api/v1 prefix — these are redirect_uris) ──────
from fastapi import Request
from fastapi.responses import HTMLResponse

@app.get("/auth/youtube/callback", response_class=HTMLResponse, include_in_schema=False)
async def youtube_oauth_callback(request: Request):
    """
    Google redirects the user here after the OAuth consent screen.
    We store the code in the in-memory session and close the popup window.
    """
    from app.services.youtube_oauth import receive_youtube_oauth_callback
    params = dict(request.query_params)
    state = params.get("state", "")
    code = params.get("code")
    error = params.get("error")
    await receive_youtube_oauth_callback(state, code, error)
    # Return a minimal page that auto-closes the popup
    status_msg = "Authorization received. You may close this window." if code else f"Authorization failed: {error or 'unknown error'}"
    color = "#16a34a" if code else "#dc2626"
    return HTMLResponse(content=f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>YouTube Authorization</title>
<style>body{{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}}
.card{{background:#fff;border-radius:12px;padding:2rem;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:400px;text-align:center}}
p{{color:{color};font-size:1rem;margin:.5rem 0}}</style></head>
<body><div class="card"><p>{status_msg}</p>
<script>try{{window.close()}}catch(e){{}}</script></div></body></html>""")


@app.get("/auth/tiktok-shop/callback", response_class=HTMLResponse, include_in_schema=False)
async def tiktok_shop_oauth_callback(request: Request):
    """
    TikTok Shop redirects the user here after the OAuth authorization screen.
    We store the code in the in-memory session for polling.
    """
    from app.services.tiktok_shop_oauth import receive_tiktok_shop_oauth_callback
    params = dict(request.query_params)
    state = params.get("state", "")
    code = params.get("code")
    error = params.get("error")
    await receive_tiktok_shop_oauth_callback(state, code, error)
    # Return a minimal page that auto-closes the window
    status_msg = "Authorization received. You may close this window." if code else f"Authorization failed: {error or 'unknown error'}"
    color = "#16a34a" if code else "#dc2626"
    return HTMLResponse(content=f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>TikTok Shop Authorization</title>
<style>body{{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}}
.card{{background:#fff;border-radius:12px;padding:2rem;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:400px;text-align:center}}
p{{color:{color};font-size:1rem;margin:.5rem 0}}</style></head>
<body><div class="card"><p>{status_msg}</p>
<script>try{{window.close()}}catch(e){{}}</script></div></body></html>""")


app.include_router(creator_dashboard.router, prefix="/api/v1/creator/dashboard", tags=["creator-dashboard"])
app.include_router(ai_management.router, prefix="/api/v1/ai-management", tags=["ai-management"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["analytics"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(social_profiles.router, prefix="/api/v1/social-profiles", tags=["social-profiles"])
app.include_router(tiktok_shop.router, prefix="/api/v1", tags=["tiktok-shop"])
app.include_router(crawl_jobs.router, prefix="/api/v1/crawl-jobs", tags=["crawl-jobs"])
app.include_router(sources.router, prefix="/api/v1", tags=["sources"])
app.include_router(contents.router, prefix="/api/v1/contents", tags=["contents"])
app.include_router(media_proxy.router, prefix="/api/v1/media-proxy", tags=["media-proxy"])
app.include_router(stories.router, prefix="/api/v1", tags=["stories"])
app.include_router(planning_runs.router, prefix="/api/v1/planning-runs", tags=["planning-runs"])
app.include_router(profile_planning.router, prefix="/api/v1/profile", tags=["profile-planning"])
app.include_router(media_workflows.router, prefix="/api/v1/media-workflows", tags=["media-workflows"])
app.include_router(content_series.router, prefix="/api/v1/content-series", tags=["content-series"])
app.include_router(generate_video.router, prefix="/api/v1/generate-video", tags=["generate-video"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "api-service"}


# Mount static files for avatars - Use absolute path
from pathlib import Path as PathLib
PROJECT_ROOT = PathLib(__file__).parent.parent.parent.parent
AVATAR_DIR = PROJECT_ROOT / "runtime" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=str(AVATAR_DIR)), name="avatars")

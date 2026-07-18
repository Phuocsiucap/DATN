from fastapi import APIRouter

from backend.user_service.app.api.routes import admin_users, articles, auth, health, internal, publish, social_profiles, stats

router = APIRouter()

router.include_router(health.router, prefix="/health", tags=["health"])
router.include_router(auth.router, prefix="/api/auth", tags=["auth"])
router.include_router(admin_users.router, prefix="/api/admin/users", tags=["admin-users"])
router.include_router(publish.router, prefix="/api/publish", tags=["publish"])
router.include_router(articles.router, prefix="/api/articles", tags=["articles"])
router.include_router(social_profiles.router, prefix="/api/social-profiles", tags=["social-profiles"])
router.include_router(stats.router, prefix="/api/stats", tags=["stats"])
router.include_router(internal.router, prefix="/api/internal", tags=["internal"])

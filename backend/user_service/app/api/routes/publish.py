import asyncio
from fastapi import APIRouter, Depends, HTTPException, status
from backend.user_service.app.schemas.requests import PublishRequest
from backend.user_service.app.core.database_mongo import articles_col
from backend.user_service.app.core.database import get_db
from backend.user_service.app.api.routes.auth import get_current_user
from backend.user_service.app.models.user import SocialProfile, User
from backend.user_service.app.services.publisher_gateway import request_publish
from sqlalchemy.orm import Session

router = APIRouter()

@router.post("")
async def trigger_publish(
    req: PublishRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = articles_col.find_one({"link": req.link})
    if not doc:
        raise HTTPException(status_code=404, detail="Article not found")

    results = {}
    for platform in req.platforms:
        if platform == "tiktok":
            if not req.profile_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Vui lòng chọn ít nhất một TikTok account để đăng",
                )

            profiles = (
                db.query(SocialProfile)
                .filter(
                    SocialProfile.id.in_(req.profile_ids),
                    SocialProfile.user_id == current_user.id,
                    SocialProfile.platform == "tiktok",
                )
                .all()
            )
            profile_map = {profile.id: profile for profile in profiles}
            missing_ids = [profile_id for profile_id in req.profile_ids if profile_id not in profile_map]
            if missing_ids:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Không tìm thấy TikTok account thuộc user hiện tại: {missing_ids}",
                )

            results[platform] = {}
            for profile_id in req.profile_ids:
                profile = profile_map[profile_id]
                if profile.status != "active":
                    results[platform][str(profile_id)] = {
                        "success": False,
                        "error": f"Profile {profile.profile_name} chưa active",
                    }
                    continue
                results[platform][str(profile_id)] = request_publish(
                    user_id=current_user.id,
                    article_link=req.link,
                    platform=platform,
                    profile_id=profile.id,
                )
        else:
            results[platform] = request_publish(
                user_id=current_user.id,
                article_link=req.link,
                platform=platform,
            )

    return {"results": results}


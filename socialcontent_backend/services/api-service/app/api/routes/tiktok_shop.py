"""TikTok Shop Affiliate API routes."""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from common.db.models import TikTokShopCredential, User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas
from app.services.tiktok_shop_oauth import (
    start_oauth_session,
    poll_oauth_status,
    stop_oauth_session,
    receive_tiktok_shop_oauth_callback,
)
from app.services.tiktok_shop_service import TikTokShopService

router = APIRouter(prefix="/tiktok-shop", tags=["TikTok Shop Affiliate"])
logger = logging.getLogger(__name__)


# ── OAuth Endpoints ───────────────────────────────────────────────────────────


@router.post("/oauth/start", response_model=schemas.TikTokShopOAuthStartResponse)
async def start_tiktok_shop_oauth(
    payload: schemas.TikTokShopOAuthStartRequest | None = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Start TikTok Shop OAuth authorization flow.

    Generates authorization URL for user to visit. Frontend should poll
    /oauth/status while waiting for authorization.

    Returns:
        Authorization URL, session ID, state, and expiry time
    """
    session_id = secrets.token_urlsafe(16)
    result = await start_oauth_session(session_id, current_user.id)

    logger.info(
        "Started TikTok Shop OAuth for user %s (session %s)",
        current_user.id,
        session_id,
    )

    return {
        "auth_url": result["auth_url"],
        "session_id": result["session_id"],
        "state": result["state"],
        "expires_in": result["expires_in"],
    }


@router.get("/oauth/status", response_model=schemas.TikTokShopOAuthPollResponse)
async def get_tiktok_shop_oauth_status(
    session_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Poll TikTok Shop OAuth session status.

    Frontend should poll this endpoint every 2-3 seconds while waiting for
    user to complete authorization.

    When authenticated=True, creates TikTokShopCredential record in database.

    Returns:
        Session status, authentication state, shop info (if authenticated)
    """
    result = await poll_oauth_status(session_id, current_user.id)

    # If authenticated, save credential to database
    if result.get("authenticated") and result.get("token_data") and result.get("shop_info"):
        token_data = result["token_data"]
        shop_info = result["shop_info"]

        # Check if credential already exists for this shop
        existing = (
            db.query(TikTokShopCredential)
            .filter(
                TikTokShopCredential.user_id == current_user.id,
                TikTokShopCredential.shop_id == shop_info["shop_id"],
            )
            .first()
        )

        if existing:
            # Update existing credential
            existing.shop_name = shop_info["shop_name"]
            existing.shop_cipher = shop_info.get("shop_cipher")
            existing.access_token = token_data["access_token"]
            existing.refresh_token = token_data.get("refresh_token")
            existing.token_expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=token_data.get("expires_in", 0)
            )
            if token_data.get("refresh_expires_in"):
                existing.refresh_expires_at = datetime.now(timezone.utc) + timedelta(
                    seconds=token_data["refresh_expires_in"]
                )
            existing.authorized_scopes = token_data.get("scopes", [])
            existing.metadata_json = {"region": shop_info.get("region", "")}
            existing.status = "active"
            existing.updated_at = datetime.now(timezone.utc)

            db.commit()
            db.refresh(existing)

            logger.info(
                "Updated TikTok Shop credential %s for shop %s",
                existing.id,
                shop_info["shop_id"],
            )
        else:
            # Create new credential
            credential = TikTokShopCredential(
                user_id=current_user.id,
                shop_id=shop_info["shop_id"],
                shop_name=shop_info["shop_name"],
                shop_cipher=shop_info.get("shop_cipher"),
                access_token=token_data["access_token"],
                refresh_token=token_data.get("refresh_token"),
                token_expires_at=datetime.now(timezone.utc) + timedelta(
                    seconds=token_data.get("expires_in", 0)
                ),
                refresh_expires_at=(
                    datetime.now(timezone.utc) + timedelta(seconds=token_data["refresh_expires_in"])
                    if token_data.get("refresh_expires_in")
                    else None
                ),
                authorized_scopes=token_data.get("scopes", []),
                metadata_json={"region": shop_info.get("region", "")},
                status="active",
            )

            db.add(credential)
            db.commit()
            db.refresh(credential)

            logger.info(
                "Created TikTok Shop credential %s for shop %s",
                credential.id,
                shop_info["shop_id"],
            )

    return result


@router.post("/oauth/{session_id}/cancel")
async def cancel_tiktok_shop_oauth(
    session_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Cancel pending TikTok Shop OAuth session.

    Returns:
        Success message
    """
    await stop_oauth_session(session_id, current_user.id)
    return {"message": "OAuth session cancelled"}


@router.get("/auth/callback")
async def tiktok_shop_oauth_callback(
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> dict:
    """Receive OAuth redirect from TikTok Shop."""
    await receive_tiktok_shop_oauth_callback(state=state, code=code, error=error)
    return {"message": "Authorization received. You may close this window."}


# ── Credential Management Endpoints ───────────────────────────────────────────


@router.get("/credentials", response_model=list[schemas.TikTokShopCredentialResponse])
def list_tiktok_shop_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """List user's TikTok Shop credentials.

    Only returns active credentials.

    Returns:
        List of TikTok Shop credentials
    """
    credentials = (
        db.query(TikTokShopCredential)
        .filter(
            TikTokShopCredential.user_id == current_user.id,
            TikTokShopCredential.status == "active",
        )
        .order_by(TikTokShopCredential.created_at.desc())
        .all()
    )

    return [
        {
            "id": cred.id,
            "shop_id": cred.shop_id,
            "shop_name": cred.shop_name,
            "authorized_scopes": cred.authorized_scopes or [],
            "token_expires_at": cred.token_expires_at,
            "status": cred.status,
            "created_at": cred.created_at,
        }
        for cred in credentials
    ]


@router.delete("/credentials/{credential_id}", status_code=204)
def disconnect_tiktok_shop_credential(
    credential_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Disconnect TikTok Shop credential.

    Sets status to 'disconnected'. Does not delete the record to preserve
    historical data.
    """
    credential = db.get(TikTokShopCredential, credential_id)

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TikTok Shop credential không tồn tại",
        )

    if credential.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập credential này",
        )

    credential.status = "disconnected"
    credential.updated_at = datetime.now(timezone.utc)
    db.commit()

    logger.info(
        "Disconnected TikTok Shop credential %s (shop %s) for user %s",
        credential_id,
        credential.shop_id,
        current_user.id,
    )


# ── Profile & Showcase Endpoints ──────────────────────────────────────────────


@router.get("/profile")
async def get_creator_profile(
    credential_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """GET /affiliate_creator/202405/profiles — creator profile info."""
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential or credential.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="TikTok Shop credential không tồn tại")
    service = TikTokShopService(db)
    return await service.get_creator_profile(credential_id)


@router.get("/showcase/products", response_model=schemas.TikTokShopProductSearchResponse)
async def get_showcase_products(
    credential_id: uuid.UUID = Query(...),
    page_size: int = Query(default=20, ge=1, le=20),
    origin: str = Query(default="SHOWCASE"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """GET /affiliate_creator/202405/showcases/products — list showcase products."""
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential or credential.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="TikTok Shop credential không tồn tại")
    service = TikTokShopService(db)
    result = await service.get_showcase_products(credential_id, page_size=page_size, origin=origin)
    return {**result, "page_number": 1}


# ── Product Search Endpoint ───────────────────────────────────────────────────


@router.post("/products/search", response_model=schemas.TikTokShopProductSearchResponse)
async def search_tiktok_shop_products(
    payload: schemas.TikTokShopProductSearchRequest,
    credential_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Search TikTok Shop products available for affiliate promotion.

    Required scope: product.read

    Args:
        payload: Search query and pagination parameters
        credential_id: TikTok Shop credential ID

    Returns:
        Paginated list of products with commission rates
    """
    # Verify credential ownership
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TikTok Shop credential không tồn tại",
        )

    if credential.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập credential này",
        )

    # Call service
    try:
        service = TikTokShopService(db)
        result = await service.search_products(
            credential_id=credential_id,
            query=payload.query,
            page_number=payload.page_number,
            page_size=payload.page_size,
        )

        # Transform products to match schema
        products = []
        for p in result.get("products", []):
            products.append({
                "product_id": p.get("product_id", ""),
                "product_name": p.get("product_name", ""),
                "image_url": p.get("image_url"),
                "price": p.get("price"),
                "currency": p.get("currency"),
                "commission_rate": p.get("commission_rate"),
                "shop_name": p.get("shop_name"),
                "detail_link": p.get("detail_link"),
            })

        return {
            "products": products,
            "total": result.get("total", 0),
            "has_more": result.get("has_more", False),
            "page_number": payload.page_number,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Product search failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không tìm kiếm được sản phẩm TikTok Shop",
        ) from exc


# ── Collaboration Endpoints ───────────────────────────────────────────────────


@router.post("/collaborations/apply")
async def apply_tiktok_shop_collaboration(
    payload: schemas.TikTokShopCollaborationApplyRequest,
    credential_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Apply for product collaboration (affiliate partnership).

    Required scope: affiliate.apply

    Args:
        payload: Product ID to apply for
        credential_id: TikTok Shop credential ID

    Returns:
        Application status and message
    """
    # Verify credential ownership
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TikTok Shop credential không tồn tại",
        )

    if credential.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập credential này",
        )

    # Call service
    try:
        service = TikTokShopService(db)
        result = await service.apply_collaboration(
            credential_id=credential_id,
            product_id=payload.product_id,
        )

        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Collaboration apply failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không apply được collaboration TikTok Shop",
        ) from exc


@router.post("/collaborations/target")
async def search_target_collaborations(
    payload: schemas.TikTokShopCollaborationStatusRequest,
    credential_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """POST /affiliate_creator/202405/target_collaborations/search"""
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential or credential.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Credential not found")
    service = TikTokShopService(db)
    result = await service.query_collaboration_status(credential_id, payload.product_ids)
    return result


@router.post("/collaborations/status")
async def query_tiktok_shop_collaboration_status(
    payload: schemas.TikTokShopCollaborationStatusRequest,
    credential_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Query collaboration status for multiple products.

    Required scope: affiliate.apply

    Args:
        payload: List of product IDs to query
        credential_id: TikTok Shop credential ID

    Returns:
        List of collaboration statuses
    """
    # Verify credential ownership
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TikTok Shop credential không tồn tại",
        )

    if credential.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập credential này",
        )

    # Call service
    try:
        service = TikTokShopService(db)
        result = await service.query_collaboration_status(
            credential_id=credential_id,
            product_ids=payload.product_ids,
        )

        return {
            "collaborations": result.get("collaborations", []),
            "target_collaborations": result.get("target_collaborations", []),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Collaboration status query failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không query được collaboration status TikTok Shop",
        ) from exc


# ── Affiliate Link Generation Endpoint ────────────────────────────────────────


@router.post("/links", response_model=schemas.TikTokShopGenerateLinkResponse)
async def generate_tiktok_shop_affiliate_link(
    payload: schemas.TikTokShopGenerateLinkRequest,
    credential_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Generate affiliate promotion link for approved product.

    Product must have approved collaboration before generating link.
    Required scope: affiliate.apply

    Args:
        payload: Product ID and link type
        credential_id: TikTok Shop credential ID

    Returns:
        Affiliate link and QR code URL (if applicable)
    """
    # Verify credential ownership
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TikTok Shop credential không tồn tại",
        )

    if credential.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập credential này",
        )

    # Call service
    try:
        service = TikTokShopService(db)
        result = await service.generate_affiliate_link(
            credential_id=credential_id,
            product_id=payload.product_id,
            promotion_link_type=payload.promotion_link_type,
        )

        return {
            "product_id": payload.product_id,
            "affiliate_link": result.get("promotion_link", ""),
            "short_link": result.get("promotion_link"),
            "qr_code_url": result.get("qr_code_url"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Affiliate link generation failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không tạo được affiliate link TikTok Shop",
        ) from exc


# ── Orders Tracking Endpoint ──────────────────────────────────────────────────


@router.get("/orders", response_model=schemas.TikTokShopOrdersResponse)
async def fetch_tiktok_shop_orders(
    credential_id: uuid.UUID = Query(...),
    start_time: datetime = Query(...),
    end_time: datetime = Query(...),
    page_number: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Fetch affiliate orders within time range.

    Returns orders with commission amounts for tracking earnings.
    Required scope: affiliate.order.read

    Args:
        credential_id: TikTok Shop credential ID
        start_time: Range start (ISO datetime)
        end_time: Range end (ISO datetime)
        page_number: Page number
        page_size: Items per page (max 50)

    Returns:
        Paginated list of orders with commission amounts
    """
    # Verify credential ownership
    credential = db.get(TikTokShopCredential, credential_id)
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="TikTok Shop credential không tồn tại",
        )

    if credential.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập credential này",
        )

    # Convert datetime to Unix timestamp
    start_timestamp = int(start_time.timestamp())
    end_timestamp = int(end_time.timestamp())

    # Call service
    try:
        service = TikTokShopService(db)
        result = await service.fetch_orders(
            credential_id=credential_id,
            start_time=start_timestamp,
            end_time=end_timestamp,
            page_number=page_number,
            page_size=page_size,
        )

        # Transform orders to match schema
        orders = []
        for o in result.get("orders", []):
            ct = o.get("create_time")
            order_dt = (
                ct
                if isinstance(ct, datetime)
                else (
                    datetime.fromtimestamp(ct, tz=timezone.utc)
                    if isinstance(ct, (int, float)) and ct > 0
                    else datetime.now(timezone.utc)
                )
            )
            orders.append({
                "order_id": o.get("order_id", ""),
                "product_id": o.get("product_id", ""),
                "product_name": o.get("product_name", ""),
                "order_amount": o.get("order_amount", 0),
                "commission_amount": o.get("commission_amount", 0),
                "order_status": o.get("order_status", ""),
                "create_time": order_dt,
            })

        return {
            "orders": orders,
            "total": result.get("total", 0),
            "has_more": result.get("has_more", False),
            "page_number": page_number,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Orders fetch failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không lấy được danh sách order TikTok Shop",
        ) from exc

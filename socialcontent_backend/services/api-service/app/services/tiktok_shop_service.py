"""TikTok Shop high-level service for affiliate operations.

Provides business-logic methods for product search, collaboration management,
affiliate link generation, and order tracking. Handles credential loading,
token refresh, and error handling.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import TikTokShopCredential
from app.services.tiktok_shop_client import TikTokShopClient

logger = logging.getLogger(__name__)


class TikTokShopService:
    """High-level service for TikTok Shop Affiliate API operations."""

    def __init__(self, db: Session):
        """Initialize service with database session.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        settings = get_settings()
        self.app_key = settings.tiktok_shop_app_key
        self.app_secret = settings.tiktok_shop_app_secret

    def _get_credential(self, credential_id: uuid.UUID) -> TikTokShopCredential:
        """Load credential by ID.

        Args:
            credential_id: TikTok Shop credential ID

        Returns:
            TikTokShopCredential object

        Raises:
            HTTPException: If credential not found
        """
        credential = self.db.query(TikTokShopCredential).filter(TikTokShopCredential.id == credential_id).first()
        if not credential:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="TikTok Shop credential không tồn tại",
            )
        if credential.status != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"TikTok Shop credential không hoạt động (status={credential.status})",
            )
        return credential

    async def _ensure_fresh_token(self, credential: TikTokShopCredential) -> str:
        """Ensure access token is valid and refresh if needed.

        Args:
            credential: TikTok Shop credential object

        Returns:
            Valid access token

        Raises:
            HTTPException: If token refresh fails
        """
        if not credential.access_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="TikTok Shop credential thiếu access_token",
            )

        # Check if token is expired or about to expire (within 5 minutes)
        now = datetime.now(timezone.utc)
        if credential.token_expires_at and credential.token_expires_at <= now + timedelta(minutes=5):
            logger.info("TikTok Shop access token expired or expiring soon, refreshing...")

            if not credential.refresh_token:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="TikTok Shop credential thiếu refresh_token, cần ủy quyền lại",
                )

            # Check refresh token expiry
            if credential.refresh_expires_at and credential.refresh_expires_at <= now:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="TikTok Shop refresh_token đã hết hạn, cần ủy quyền lại",
                )

            # Refresh token
            client = TikTokShopClient(self.app_key, self.app_secret)
            token_data = await client.refresh_access_token(credential.refresh_token)

            # Update credential
            credential.access_token = token_data["access_token"]
            credential.refresh_token = token_data.get("refresh_token") or credential.refresh_token
            credential.token_expires_at = now + timedelta(seconds=token_data.get("expires_in", 0))
            if token_data.get("refresh_expires_in"):
                credential.refresh_expires_at = now + timedelta(seconds=token_data["refresh_expires_in"])
            credential.updated_at = now

            self.db.commit()
            logger.info("TikTok Shop token refreshed for credential %s", credential.id)

        return credential.access_token

    async def search_products(
        self,
        credential_id: uuid.UUID,
        query: str,
        page_number: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """Search products available for affiliate promotion.

        Calls TikTok Shop /api/products/search endpoint.
        Required scope: product.read

        Args:
            credential_id: TikTok Shop credential ID
            query: Search query string
            page_number: Page number (1-indexed)
            page_size: Number of items per page (max 100)

        Returns:
            dict with products (list), total (int), has_more (bool)

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/api/products/search"

        try:
            response = await client.post(
                path,
                data={
                    "search_query": query,
                    "page_number": page_number,
                    "page_size": min(page_size, 100),
                },
            )
            data = response.get("data", {})
            products = data.get("products", [])
            total = data.get("total", 0)

            logger.info(
                "TikTok Shop product search: query=%s, page=%d, found=%d",
                query,
                page_number,
                len(products),
            )

            return {
                "products": products,
                "total": total,
                "has_more": page_number * page_size < total,
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("TikTok Shop product search failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không tìm kiếm được sản phẩm TikTok Shop",
            ) from exc

    async def apply_collaboration(self, credential_id: uuid.UUID, product_id: str) -> dict[str, Any]:
        """Apply for product collaboration (affiliate partnership).

        Calls TikTok Shop /api/affiliate/product_apply endpoint.
        Required scope: affiliate.apply

        Args:
            credential_id: TikTok Shop credential ID
            product_id: Product ID to apply for

        Returns:
            dict with application_id, status, message

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/api/affiliate/product_apply"

        try:
            response = await client.post(
                path,
                data={"product_id": product_id},
            )
            data = response.get("data", {})

            logger.info(
                "TikTok Shop collaboration applied: product_id=%s, status=%s",
                product_id,
                data.get("status"),
            )

            return {
                "application_id": data.get("application_id"),
                "status": data.get("status"),
                "message": data.get("message"),
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("TikTok Shop collaboration apply failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không apply được collaboration TikTok Shop",
            ) from exc

    async def query_collaboration_status(
        self,
        credential_id: uuid.UUID,
        product_ids: list[str],
    ) -> dict[str, Any]:
        """Query collaboration status for multiple products.

        Calls TikTok Shop /api/affiliate/collaboration_query endpoint.
        Required scope: affiliate.apply

        Args:
            credential_id: TikTok Shop credential ID
            product_ids: List of product IDs to query

        Returns:
            dict with collaborations (list of {product_id, status, commission_rate, ...})

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/api/affiliate/collaboration_query"

        try:
            response = await client.post(
                path,
                data={"product_ids": product_ids},
            )
            data = response.get("data", {})
            collaborations = data.get("collaborations", [])

            logger.info(
                "TikTok Shop collaboration query: products=%d, results=%d",
                len(product_ids),
                len(collaborations),
            )

            return {"collaborations": collaborations}
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("TikTok Shop collaboration query failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không query được collaboration status TikTok Shop",
            ) from exc

    async def generate_affiliate_link(
        self,
        credential_id: uuid.UUID,
        product_id: str,
        promotion_link_type: str = "ShortLink",
    ) -> dict[str, Any]:
        """Generate affiliate promotion link for approved product.

        Calls TikTok Shop /api/affiliate/create_link endpoint.
        Required scope: affiliate.apply

        Args:
            credential_id: TikTok Shop credential ID
            product_id: Product ID (must have approved collaboration)
            promotion_link_type: Link type (ShortLink, LongLink, QRCode)

        Returns:
            dict with promotion_link, qr_code_url (if applicable)

        Raises:
            HTTPException: If request fails or collaboration not approved
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/api/affiliate/create_link"

        try:
            response = await client.post(
                path,
                data={
                    "product_id": product_id,
                    "promotion_link_type": promotion_link_type,
                },
            )
            data = response.get("data", {})

            logger.info(
                "TikTok Shop affiliate link generated: product_id=%s, link_type=%s",
                product_id,
                promotion_link_type,
            )

            return {
                "promotion_link": data.get("promotion_link"),
                "qr_code_url": data.get("qr_code_url"),
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("TikTok Shop affiliate link generation failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không tạo được affiliate link TikTok Shop",
            ) from exc

    async def fetch_orders(
        self,
        credential_id: uuid.UUID,
        start_time: int,
        end_time: int,
        page_number: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """Fetch affiliate orders within time range.

        Calls TikTok Shop /api/affiliate/order_list endpoint.
        Required scope: affiliate.order.read

        Args:
            credential_id: TikTok Shop credential ID
            start_time: Unix timestamp (seconds) for range start
            end_time: Unix timestamp (seconds) for range end
            page_number: Page number (1-indexed)
            page_size: Number of items per page (max 50)

        Returns:
            dict with orders (list), total (int), has_more (bool)

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/api/affiliate/order_list"

        try:
            response = await client.post(
                path,
                data={
                    "start_time": start_time,
                    "end_time": end_time,
                    "page_number": page_number,
                    "page_size": min(page_size, 50),
                },
            )
            data = response.get("data", {})
            orders = data.get("orders", [])
            total = data.get("total", 0)

            logger.info(
                "TikTok Shop orders fetched: range=%d-%d, page=%d, found=%d",
                start_time,
                end_time,
                page_number,
                len(orders),
            )

            return {
                "orders": orders,
                "total": total,
                "has_more": page_number * page_size < total,
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("TikTok Shop order fetch failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không lấy được danh sách order TikTok Shop",
            ) from exc

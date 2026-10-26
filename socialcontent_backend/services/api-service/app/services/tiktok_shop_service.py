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
        """Search products available for open collaboration.

        Calls TikTok Shop POST /affiliate_creator/202405/open_collaborations/products/search.

        Args:
            credential_id: TikTok Shop credential ID
            query: Search query string
            page_number: Page number (1-indexed)
            page_size: Number of items per page (max 20 per OAS)

        Returns:
            dict with products (list), total (int), has_more (bool)

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/affiliate_creator/202405/open_collaborations/products/search"
        body = {
            "title_keywords": [kw.strip() for kw in query.split() if kw.strip()][:20],
        }
        query_params = {"page_size": min(page_size, 20)}

        try:
            response = await client.post(path, data=body, params=query_params)
            data = response.get("data", {})
            products_raw = data.get("products", [])

            products = []
            for p in products_raw:
                sp = p.get("sales_price", {})
                commission = p.get("commission", {})
                products.append({
                    "product_id": p.get("id", ""),
                    "product_name": p.get("title", ""),
                    "image_url": p.get("main_image_url"),
                    "price": float(sp.get("minimum_amount", 0) or 0),
                    "currency": sp.get("currency"),
                    "commission_rate": commission.get("rate"),  # int in hundredths of %
                    "shop_name": p.get("shop", {}).get("name"),
                    "detail_link": p.get("detail_link"),
                })

            logger.info(
                "TikTok Shop product search: query=%s, page=%d, found=%d",
                query,
                page_number,
                len(products),
            )

            return {
                "products": products,
                "total": data.get("total_count", 0),
                "has_more": bool(data.get("next_page_token")),
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
        """Add product to creator's showcase.

        Calls TikTok Shop POST /affiliate_creator/202405/showcases/products/add.

        Args:
            credential_id: TikTok Shop credential ID
            product_id: Product ID to add to showcase

        Returns:
            dict with success, errors, message

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/affiliate_creator/202405/showcases/products/add"
        body = {"add_type": "PRODUCT_ID", "product_ids": [product_id]}

        try:
            response = await client.post(path, data=body)
            data = response.get("data", {})
            errors = data.get("errors", [])
            success = len(errors) == 0

            logger.info(
                "TikTok Shop add to showcase: product_id=%s, success=%s",
                product_id,
                success,
            )

            return {
                "success": success,
                "errors": errors,
                "message": "Đã thêm vào showcase" if success else (errors[0].get("message", "Thêm thất bại") if errors else "Thất bại"),
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
        """Search target collaborations.

        Calls TikTok Shop POST /affiliate_creator/202405/target_collaborations/search.

        Args:
            credential_id: TikTok Shop credential ID
            product_ids: List of product IDs to query

        Returns:
            dict with target_collaborations list

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/affiliate_creator/202405/target_collaborations/search"
        body = {}
        if product_ids:
            body = {"keyword": product_ids[0], "keyword_type": "TARGET_COLLABORATIONS_ID"}

        try:
            response = await client.post(path, data=body, params={"page_size": 20})
            data = response.get("data", {})
            target_collaborations = data.get("target_collaborations", [])

            logger.info(
                "TikTok Shop target collaboration query: results=%d",
                len(target_collaborations),
            )

            return {"target_collaborations": target_collaborations}
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
        """Fetch product promotion link from showcase products.

        Calls TikTok Shop GET /affiliate_creator/202405/showcases/products.

        Args:
            credential_id: TikTok Shop credential ID
            product_id: Product ID
            promotion_link_type: Link type parameter

        Returns:
            dict with promotion_link, qr_code_url

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        path = "/affiliate_creator/202405/showcases/products"

        try:
            response = await client.get(path, params={"page_size": 20, "origin": "SHOWCASE"})
            data = response.get("data", {})
            products = data.get("products", [])
            product = next((p for p in products if p.get("id") == product_id), None)
            link = product.get("detail_link", "") if product else ""

            logger.info("TikTok Shop product link found for product_id=%s", product_id)
            return {
                "promotion_link": link,
                "qr_code_url": None,
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
        """Fetch affiliate orders.

        Calls TikTok Shop POST /affiliate_creator/202405/orders/search.

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
        path = "/affiliate_creator/202405/orders/search"
        query_params = {"page_size": min(page_size, 50)}

        try:
            response = await client.post(path, data={}, params=query_params)
            data = response.get("data", {})
            orders_raw = data.get("orders", [])

            orders = []
            for o in orders_raw:
                line_items = o.get("line_items", [])
                for item in line_items:
                    orders.append({
                        "order_id": o.get("id", ""),
                        "product_id": item.get("product_id", ""),
                        "product_name": "",
                        "order_amount": 0,
                        "commission_amount": 0,
                        "order_status": "",
                        "create_time": datetime.now(timezone.utc),
                    })

            logger.info(
                "TikTok Shop orders fetched: count=%d",
                len(orders),
            )

            return {
                "orders": orders,
                "total": data.get("total_count", 0),
                "has_more": bool(data.get("next_page_token")),
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("TikTok Shop order fetch failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Không lấy được danh sách order TikTok Shop",
            ) from exc

    async def get_creator_profile(self, credential_id: uuid.UUID) -> dict[str, Any]:
        """Get creator profile.

        Calls TikTok Shop GET /affiliate_creator/202405/profiles.

        Args:
            credential_id: TikTok Shop credential ID

        Returns:
            dict with creator profile data

        Raises:
            HTTPException: If request fails
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        response = await client.get("/affiliate_creator/202405/profiles")
        return response.get("data", {})

    async def get_showcase_products(
        self,
        credential_id: uuid.UUID,
        page_size: int = 20,
        origin: str = "SHOWCASE",
    ) -> dict[str, Any]:
        """List products in creator's showcase.

        Calls TikTok Shop GET /affiliate_creator/202405/showcases/products.

        Args:
            credential_id: TikTok Shop credential ID
            page_size: Number of items per page (max 20)
            origin: Origin filter (SHOWCASE)

        Returns:
            dict with products, total, has_more
        """
        credential = self._get_credential(credential_id)
        access_token = await self._ensure_fresh_token(credential)

        client = TikTokShopClient(self.app_key, self.app_secret, access_token)
        response = await client.get(
            "/affiliate_creator/202405/showcases/products",
            params={"page_size": min(page_size, 20), "origin": origin},
        )
        data = response.get("data", {})
        products_raw = data.get("products", [])
        products = []
        for p in products_raw:
            commission = p.get("commission", {})
            price = p.get("price", {})
            sp = price.get("seller_discount_price", {})
            products.append({
                "product_id": p.get("id", ""),
                "product_name": p.get("title", ""),
                "image_url": (p.get("main_images") or [{}])[0].get("url"),
                "price": float(sp.get("minimum_amount", 0) or 0),
                "currency": sp.get("currency"),
                "commission_rate": commission.get("rate"),  # hundredths of %
                "shop_name": p.get("shop", {}).get("name"),
                "detail_link": p.get("detail_link"),
                "status": p.get("status", {}),
            })
        return {
            "products": products,
            "total": data.get("total_count", 0),
            "has_more": bool(data.get("next_page_token")),
        }

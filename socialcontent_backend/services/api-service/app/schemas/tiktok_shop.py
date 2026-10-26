"""Pydantic schemas for TikTok Shop Affiliate API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── OAuth Schemas ─────────────────────────────────────────────────────────────


class TikTokShopOAuthStartRequest(BaseModel):
    """Request to start TikTok Shop OAuth flow."""

    redirect_uri: str | None = None


class TikTokShopOAuthStartResponse(BaseModel):
    """Response from OAuth start endpoint."""

    auth_url: str
    session_id: str
    state: str
    expires_in: int


class TikTokShopOAuthPollResponse(BaseModel):
    """Response from OAuth poll endpoint."""

    session_active: bool
    authenticated: bool
    status: str | None = None
    auth_url: str | None = None
    shop_info: dict[str, Any] | None = None
    token_data: dict[str, Any] | None = None


# ── Credential Schemas ────────────────────────────────────────────────────────


class TikTokShopCredentialResponse(BaseModel):
    """TikTok Shop credential information."""

    id: uuid.UUID
    shop_id: str
    shop_name: str
    authorized_scopes: list[str]
    token_expires_at: datetime | None
    status: str
    created_at: datetime


# ── Product Schemas ───────────────────────────────────────────────────────────


class TikTokShopProductSearchRequest(BaseModel):
    """Request to search TikTok Shop products."""

    query: str = Field(..., min_length=1, max_length=200)
    page_number: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class TikTokShopProduct(BaseModel):
    """TikTok Shop product information."""

    product_id: str
    product_name: str
    image_url: str | None = None
    price: float | None = None
    currency: str | None = None
    commission_rate: int | None = None  # int in hundredths of % (e.g. 3000 = 30.00%)
    shop_name: str | None = None
    detail_link: str | None = None


class TikTokShopProductSearchResponse(BaseModel):
    """Response from product search endpoint."""

    products: list[TikTokShopProduct]
    total: int
    has_more: bool
    page_number: int


# ── Collaboration Schemas ─────────────────────────────────────────────────────


class TikTokShopCollaborationApplyRequest(BaseModel):
    """Request to apply for product collaboration / add to showcase."""

    product_id: str = Field(..., min_length=1)


class TikTokShopCollaborationApplyResponse(BaseModel):
    """Response from applying / adding to showcase."""

    success: bool
    errors: list[dict[str, Any]] = []
    message: str


class TikTokShopCollaborationStatusRequest(BaseModel):
    """Request to query collaboration status."""

    product_ids: list[str] = Field(default=[], min_length=0)


class TikTokShopCollaborationStatus(BaseModel):
    """Collaboration status for a product."""

    product_id: str
    status: str
    commission_rate: float | None = None
    approved_at: datetime | None = None


class TikTokShopTargetCollaboration(BaseModel):
    """Target collaboration search result."""

    id: str
    name: str
    status: str
    products: list[dict[str, Any]] = []


# ── Creator Profile Schema ────────────────────────────────────────────────────


class TikTokShopCreatorProfile(BaseModel):
    """Creator profile information."""

    creator_user_id: str | None = None
    username: str | None = None
    register_region: str | None = None
    selection_region: str | None = None
    user_type: str | None = None
    permissions: list[str] = []
    avatar: dict[str, Any] | None = None


# ── Affiliate Link Schemas ────────────────────────────────────────────────────


class TikTokShopGenerateLinkRequest(BaseModel):
    """Request to generate affiliate link."""

    product_id: str = Field(..., min_length=1)
    promotion_link_type: str = Field(default="ShortLink")


class TikTokShopGenerateLinkResponse(BaseModel):
    """Response from affiliate link generation."""

    product_id: str
    affiliate_link: str
    short_link: str | None = None
    qr_code_url: str | None = None


# ── Orders Schemas ────────────────────────────────────────────────────────────


class TikTokShopOrdersRequest(BaseModel):
    """Request to fetch affiliate orders."""

    start_time: datetime
    end_time: datetime
    page_number: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=50)


class TikTokShopOrder(BaseModel):
    """TikTok Shop affiliate order information."""

    order_id: str
    product_id: str
    product_name: str
    order_amount: float
    commission_amount: float
    order_status: str
    create_time: datetime


class TikTokShopOrdersResponse(BaseModel):
    """Response from orders endpoint."""

    orders: list[TikTokShopOrder]
    total: int
    has_more: bool
    page_number: int

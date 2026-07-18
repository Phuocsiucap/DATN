import os

from fastapi import APIRouter, Request
from fastapi.responses import Response

from backend.gateway.app.api.proxy import proxy_request

router = APIRouter()

USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_admin_users(path: str, request: Request) -> Response:
    return await proxy_request(
        request,
        f"{USER_SERVICE_URL}/api/admin/users/{path}",
        "User service",
    )


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_admin_users_root(request: Request) -> Response:
    return await proxy_request(request, f"{USER_SERVICE_URL}/api/admin/users", "User service")

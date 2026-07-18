import asyncio
import json
import os
from typing import Dict

import httpx
import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "supersecretkey_please_change_in_production")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

router = APIRouter()
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")

# Connected dashboard sockets keyed by their authenticated user id.
_clients: Dict[WebSocket, int] = {}


def _authenticate_websocket(websocket: WebSocket) -> int | None:
    token = websocket.cookies.get("access_token")
    if not token:
        return None
    try:
        _, _, token_value = token.partition(" ")
        payload = jwt.decode(token_value, SECRET_KEY, algorithms=[ALGORITHM])
        token_user_id = payload.get("user_id")
    except jwt.PyJWTError:
        return None
    if token_user_id:
        return int(token_user_id)

    try:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response = client.get(
                f"{USER_SERVICE_URL}/api/auth/me",
                headers={"cookie": websocket.headers.get("cookie", "")},
            )
    except httpx.RequestError:
        return None
    if response.status_code >= 400:
        return None
    user = response.json()
    user_id = user.get("id")
    return int(user_id) if user_id is not None else None


async def broadcast(event: dict):
    """Broadcast event to all connected WebSocket clients."""
    if not _clients:
        return
    dead = set()
    msg = json.dumps(event)
    is_bilibili_event = event.get("channel") == "bilibili_crawler"
    target_user_id = event.get("user_id") if is_bilibili_event else None
    if is_bilibili_event and target_user_id is None:
        return
    for ws, user_id in list(_clients.items()):
        if target_user_id is not None and user_id != target_user_id:
            continue
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    for ws in dead:
        _clients.pop(ws, None)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    user_id = _authenticate_websocket(websocket)
    if user_id is None:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    _clients[websocket] = user_id
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping"}))
                continue

            try:
                event = json.loads(message)
            except json.JSONDecodeError:
                continue

            if event.get("channel") == "bilibili_crawler":
                await websocket.send_text(
                    json.dumps(
                        {
                            "channel": "bilibili_crawler",
                            "request_id": event.get("request_id"),
                            "type": "search_error",
                            "detail": "Bilibili realtime search moved to the Bilibili microservice. Use HTTP search or connect to the service websocket.",
                        }
                    )
                )
    except WebSocketDisconnect:
        _clients.pop(websocket, None)
    except Exception:
        _clients.pop(websocket, None)

from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.bilibili_service.app.services.runtime import job_ws_hub
from backend.bilibili_service.app.services.search import handle_dashboard_ws_message


router = APIRouter()


@router.websocket("/ws")
async def dashboard_ws(websocket: WebSocket) -> None:
    user_id = parse_user_id(websocket)
    websocket.state.user_id = user_id
    await job_ws_hub.connect(websocket)
    await job_ws_hub.send_snapshot(websocket, user_id)

    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            await handle_dashboard_ws_message(websocket, payload)
    except WebSocketDisconnect:
        job_ws_hub.disconnect(websocket)
    except Exception:
        job_ws_hub.disconnect(websocket)


def parse_user_id(websocket: WebSocket) -> int | None:
    value = websocket.query_params.get("user_id")
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None

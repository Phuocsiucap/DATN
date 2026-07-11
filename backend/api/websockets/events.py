import asyncio
import json
from typing import Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# Global set of connected websocket clients
_clients: Set[WebSocket] = set()

async def broadcast(event: dict):
    """Broadcast event to all connected WebSocket clients."""
    if not _clients:
        return
    dead = set()
    msg = json.dumps(event)
    for ws in _clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    _clients.difference_update(dead)

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _clients.add(websocket)
    try:
        while True:
            # keep alive ping
            await asyncio.sleep(30)
            await websocket.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        _clients.discard(websocket)
    except Exception:
        _clients.discard(websocket)

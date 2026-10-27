import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.ws_manager import manager

router = APIRouter()

# ----------------- WEBSOCKET ENDPOINT -----------------
@router.websocket("/ws/gis")
async def websocket_gis_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming ping or echo
            await websocket.send_text(json.dumps({"event": "PONG", "received": data}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)

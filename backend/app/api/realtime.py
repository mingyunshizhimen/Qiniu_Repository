from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.app.realtime.models import ClientCommand
from backend.app.realtime.session import RealtimeSession

router = APIRouter(tags=["realtime"])


@router.websocket("/ws/sessions/{session_id}")
async def realtime_session(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    session = RealtimeSession(session_id)

    try:
        while True:
            message = await websocket.receive_json()
            try:
                command = ClientCommand.model_validate(message)
            except ValidationError:
                event = session.protocol_error(
                    "Message does not match protocol v1.0."
                )
                await websocket.send_json(event.model_dump(mode="json"))
                continue

            for event in session.handle(command):
                await websocket.send_json(event.model_dump(mode="json"))
    except WebSocketDisconnect:
        return

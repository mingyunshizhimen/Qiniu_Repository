import asyncio
import contextlib

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.app.core.config import Settings, get_settings
from backend.app.providers.asr import get_asr_provider
from backend.app.providers.base import ASRProvider
from backend.app.providers.base import TranslationProvider
from backend.app.providers.translation import get_translation_provider
from backend.app.providers.base import TTSProvider
from backend.app.providers.tts import get_tts_provider
from backend.app.realtime.models import ClientCommand
from backend.app.realtime.models import ServerEvent
from backend.app.realtime.pipeline import RealtimeASRPipeline
from backend.app.realtime.session import RealtimeSession

router = APIRouter(tags=["realtime"])


def get_realtime_asr_provider(
    settings: Settings = Depends(get_settings),
) -> ASRProvider:
    return get_asr_provider(settings)


def get_realtime_translation_provider(
    settings: Settings = Depends(get_settings),
) -> TranslationProvider:
    return get_translation_provider(settings)


def get_realtime_tts_provider(
    settings: Settings = Depends(get_settings),
) -> TTSProvider:
    return get_tts_provider(settings)


@router.websocket("/ws/sessions/{session_id}")
async def realtime_session(
    websocket: WebSocket,
    session_id: str,
    provider: ASRProvider = Depends(get_realtime_asr_provider),
    translation_provider: TranslationProvider = Depends(
        get_realtime_translation_provider
    ),
    tts_provider: TTSProvider = Depends(get_realtime_tts_provider),
) -> None:
    await websocket.accept()
    session = RealtimeSession(session_id)
    event_queue: asyncio.Queue[ServerEvent | None] = asyncio.Queue()

    async def enqueue_event(event: ServerEvent) -> None:
        await event_queue.put(event)

    pipeline = RealtimeASRPipeline(
        session,
        provider,
        translation_provider,
        tts_provider,
        event_sink=enqueue_event,
    )

    async def send_queued_events() -> None:
        while True:
            event = await event_queue.get()
            if event is None:
                return
            try:
                await websocket.send_json(event.model_dump(mode="json"))
            except WebSocketDisconnect:
                return

    sender_task = asyncio.create_task(send_queued_events())

    try:
        while True:
            message = await websocket.receive_json()
            try:
                command = ClientCommand.model_validate(message)
            except ValidationError:
                event = session.protocol_error(
                    "Message does not match protocol v1.0."
                )
                event_queue.put_nowait(event)
                continue

            for event in await pipeline.handle(command):
                event_queue.put_nowait(event)
    except WebSocketDisconnect:
        return
    finally:
        await pipeline.close()
        await event_queue.put(None)
        with contextlib.suppress(asyncio.CancelledError):
            await sender_task

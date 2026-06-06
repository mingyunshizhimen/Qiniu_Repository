"""TTS provider implementations for local and DashScope environments."""

import base64
import json
import logging
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4

from websockets.asyncio.client import connect as websocket_connect

from backend.app.providers.base import TTSProvider, TTSRequest, TTSResult

logger = logging.getLogger(__name__)


class WebSocketConnection(Protocol):
    async def send(self, message: str) -> None: ...

    async def recv(self) -> str | bytes: ...

    async def close(self) -> None: ...


ConnectCallable = Callable[..., Awaitable[WebSocketConnection]]


class MockTTSProvider(TTSProvider):
    """Mock speech synthesis provider for development and tests."""

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        logger.debug("Mock TTS received text: %s", request.text)
        return TTSResult(
            audio_chunks=[],
            source_text=request.text,
            provider="mock",
            voice=request.voice,
            response_format=request.response_format,
            sample_rate=request.sample_rate,
        )


class DashScopeRealtimeTTSProvider(TTSProvider):
    """DashScope realtime TTS provider using the official WebSocket API."""

    API_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    MODEL_NAME = "qwen3-tts-flash-realtime"
    TIMEOUT_SECONDS = 30.0
    DEFAULT_VOICE = "Cherry"
    DEFAULT_SAMPLE_RATE = 24000

    def __init__(
        self,
        api_key: str,
        connect: ConnectCallable = websocket_connect,
    ) -> None:
        if not api_key or not api_key.strip():
            raise ValueError("DashScope API Key cannot be empty")

        self.api_key = api_key.strip()
        self._connect = connect

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        text = request.text.strip()
        if not text:
            raise ValueError("TTS request text cannot be empty")

        websocket = await self._connect(
            f"{self.API_URL}?model={self.MODEL_NAME}",
            additional_headers={"Authorization": f"Bearer {self.api_key}"},
        )

        try:
            await self._expect_event(websocket, "session.created")
            await websocket.send(
                json.dumps(
                    {
                        "event_id": self._event_id(),
                        "type": "session.update",
                        "session": {
                            "voice": request.voice.strip()
                            or self.DEFAULT_VOICE,
                            "mode": "commit",
                            "language_type": self._language_type(
                                request.language,
                            ),
                            "response_format": request.response_format or "pcm",
                            "sample_rate": request.sample_rate
                            if request.sample_rate > 0
                            else self.DEFAULT_SAMPLE_RATE,
                        },
                    }
                )
            )
            await self._expect_event(websocket, "session.updated")

            await websocket.send(
                json.dumps(
                    {
                        "event_id": self._event_id(),
                        "type": "input_text_buffer.append",
                        "text": text,
                    }
                )
            )
            await websocket.send(
                json.dumps(
                    {
                        "event_id": self._event_id(),
                        "type": "input_text_buffer.commit",
                    }
                )
            )

            audio_chunks: list[bytes] = []
            session_finished = False
            while not session_finished:
                event = self._decode_event(await websocket.recv())
                self._raise_for_error_event(event)
                event_type = event.get("type")

                if event_type == "response.audio.delta":
                    delta = event.get("delta", "")
                    if isinstance(delta, str) and delta:
                        audio_chunks.append(base64.b64decode(delta))
                elif event_type == "response.done":
                    continue
                elif event_type == "session.finished":
                    session_finished = True

            logger.info("DashScope TTS synthesized text: %s", text[:50])
            return TTSResult(
                audio_chunks=audio_chunks,
                source_text=text,
                provider="dashscope",
                voice=request.voice.strip() or self.DEFAULT_VOICE,
                response_format=request.response_format or "pcm",
                sample_rate=request.sample_rate
                if request.sample_rate > 0
                else self.DEFAULT_SAMPLE_RATE,
            )
        finally:
            await websocket.close()

    async def _expect_event(
        self,
        websocket: WebSocketConnection,
        expected_type: str,
    ) -> dict[str, Any]:
        event = self._decode_event(await websocket.recv())
        self._raise_for_error_event(event)
        if event.get("type") != expected_type:
            raise RuntimeError(
                f"Expected {expected_type}, received {event.get('type')}"
            )
        return event

    @staticmethod
    def _decode_event(message: str | bytes) -> dict[str, Any]:
        if isinstance(message, bytes):
            message = message.decode("utf-8")
        event = json.loads(message)
        if not isinstance(event, dict):
            raise RuntimeError("DashScope TTS returned an invalid event")
        return event

    @staticmethod
    def _raise_for_error_event(event: dict[str, Any]) -> None:
        event_type = event.get("type")
        if event_type not in {"error", "session.error"}:
            return

        error = event.get("error", {})
        message = error.get("message", "Unknown DashScope TTS error")
        code = error.get("code")
        detail = f"{code}: {message}" if code else message
        raise RuntimeError(f"DashScope TTS error: {detail}")

    @staticmethod
    def _language_type(language: str) -> str:
        normalized = language.strip().lower()
        if normalized.startswith("zh"):
            return "Chinese"
        if normalized.startswith("en"):
            return "English"
        if normalized.startswith("de"):
            return "German"
        if normalized.startswith("it"):
            return "Italian"
        if normalized.startswith("pt"):
            return "Portuguese"
        if normalized.startswith("es"):
            return "Spanish"
        if normalized.startswith("ja"):
            return "Japanese"
        if normalized.startswith("ko"):
            return "Korean"
        if normalized.startswith("fr"):
            return "French"
        if normalized.startswith("ru"):
            return "Russian"
        return "Auto"

    @staticmethod
    def _event_id() -> str:
        return f"event_{uuid4().hex}"


def get_tts_provider(settings: Any) -> TTSProvider:
    api_key = getattr(settings, "dashscope_api_key", None)
    if api_key and api_key.strip():
        logger.info("Using DashScope TTS provider")
        return DashScopeRealtimeTTSProvider(api_key=api_key)

    logger.info("Using Mock TTS provider (no DashScope API Key configured)")
    return MockTTSProvider()

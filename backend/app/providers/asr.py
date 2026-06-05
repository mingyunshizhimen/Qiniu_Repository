"""ASR provider implementations for local and DashScope environments."""

import asyncio
import base64
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from uuid import uuid4

from websockets.asyncio.client import connect as websocket_connect

from backend.app.providers.base import (
    ASRAudioChunk,
    ASRProvider,
    ASRResult,
    TranscriptType,
)

logger = logging.getLogger(__name__)


class WebSocketConnection(Protocol):
    async def send(self, message: str) -> None: ...

    async def recv(self) -> str | bytes: ...

    async def close(self) -> None: ...


ConnectCallable = Callable[..., Awaitable[WebSocketConnection]]


class MockASRProvider(ASRProvider):
    """模拟 ASR Provider，用于开发和测试环境。"""

    def __init__(self) -> None:
        self._initialized = False
        self._language = "zh-CN"

    async def initialize(self, language: str) -> None:
        self._language = language
        self._initialized = True
        logger.info("Mock ASR 已初始化，语言: %s", language)

    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        if not self._initialized:
            raise RuntimeError("ASR 会话未初始化，请先调用 initialize")
        logger.debug("Mock ASR 收到音频块: %s bytes", len(chunk.data))
        return []

    async def finalize(self) -> list[ASRResult]:
        self._initialized = False
        return []


class DashScopeASRProvider(ASRProvider):
    """Qwen-ASR realtime provider using the DashScope WebSocket API."""

    API_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    MODEL_NAME = "qwen3-asr-flash-realtime"
    FINISH_TIMEOUT_SECONDS = 10.0

    def __init__(
        self,
        api_key: str,
        connect: ConnectCallable = websocket_connect,
    ) -> None:
        if not api_key or not api_key.strip():
            raise ValueError("DashScope API Key 不能为空")

        self.api_key = api_key.strip()
        self._connect = connect
        self._websocket: WebSocketConnection | None = None
        self._receiver_task: asyncio.Task[None] | None = None
        self._results: asyncio.Queue[ASRResult] = asyncio.Queue()
        self._receiver_error: RuntimeError | None = None
        self._session_finished = asyncio.Event()

    async def initialize(self, language: str) -> None:
        if self._websocket is not None:
            raise RuntimeError("ASR session is already initialized")

        url = f"{self.API_URL}?model={self.MODEL_NAME}"
        websocket = await self._connect(
            url,
            additional_headers={
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        self._websocket = websocket

        try:
            await self._expect_event("session.created")
            await websocket.send(
                json.dumps(
                    {
                        "event_id": self._event_id(),
                        "type": "session.update",
                        "session": {
                            "input_audio_format": "pcm",
                            "sample_rate": 16000,
                            "input_audio_transcription": {
                                "language": self._language_code(language),
                            },
                            "turn_detection": {
                                "type": "server_vad",
                                "threshold": 0.2,
                                "silence_duration_ms": 400,
                            },
                        },
                    }
                )
            )
            await self._expect_event("session.updated")
        except Exception:
            await self._close_connection()
            raise

        self._receiver_task = asyncio.create_task(self._receive_events())

    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        websocket = self._require_connection()
        self._raise_receiver_error()
        self._validate_chunk(chunk)

        await websocket.send(
            json.dumps(
                {
                    "event_id": self._event_id(),
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(chunk.data).decode("ascii"),
                }
            )
        )
        await asyncio.sleep(0)
        self._raise_receiver_error()
        return self._drain_results()

    async def finalize(self) -> list[ASRResult]:
        if self._websocket is None:
            return []

        try:
            self._raise_receiver_error()
            await self._websocket.send(
                json.dumps(
                    {
                        "event_id": self._event_id(),
                        "type": "session.finish",
                    }
                )
            )
            await asyncio.wait_for(
                self._session_finished.wait(),
                timeout=self.FINISH_TIMEOUT_SECONDS,
            )
            self._raise_receiver_error()
            return self._drain_results()
        except TimeoutError as exc:
            raise TimeoutError(
                "Timed out waiting for DashScope ASR to finish"
            ) from exc
        finally:
            await self._close_connection()

    async def _expect_event(self, expected_type: str) -> dict[str, Any]:
        websocket = self._require_connection()
        event = self._decode_event(await websocket.recv())
        self._raise_for_error_event(event)
        if event.get("type") != expected_type:
            raise RuntimeError(
                f"Expected {expected_type}, received {event.get('type')}"
            )
        return event

    async def _receive_events(self) -> None:
        try:
            while self._websocket is not None:
                event = self._decode_event(await self._websocket.recv())
                self._raise_for_error_event(event)
                event_type = event.get("type")

                if event_type == (
                    "conversation.item.input_audio_transcription.text"
                ):
                    text = f"{event.get('text', '')}{event.get('stash', '')}"
                    if text:
                        await self._results.put(
                            ASRResult(
                                text=text,
                                transcript_type=TranscriptType.PARTIAL,
                                is_final=False,
                                provider="dashscope",
                            )
                        )
                elif event_type == (
                    "conversation.item.input_audio_transcription.completed"
                ):
                    transcript = event.get("transcript", "")
                    if transcript:
                        await self._results.put(
                            ASRResult(
                                text=transcript,
                                transcript_type=TranscriptType.FINAL,
                                is_final=True,
                                provider="dashscope",
                            )
                        )
                elif event_type == "session.finished":
                    self._session_finished.set()
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._receiver_error = (
                exc
                if isinstance(exc, RuntimeError)
                else RuntimeError(f"DashScope ASR receive failed: {exc}")
            )
            self._session_finished.set()

    async def _close_connection(self) -> None:
        receiver_task = self._receiver_task
        self._receiver_task = None
        if receiver_task is not None and not receiver_task.done():
            receiver_task.cancel()
            try:
                await receiver_task
            except asyncio.CancelledError:
                pass

        websocket = self._websocket
        self._websocket = None
        if websocket is not None:
            await websocket.close()

        self._session_finished = asyncio.Event()

    def _require_connection(self) -> WebSocketConnection:
        if self._websocket is None:
            raise RuntimeError("ASR 会话未初始化，请先调用 initialize")
        return self._websocket

    def _raise_receiver_error(self) -> None:
        if self._receiver_error is not None:
            error = self._receiver_error
            self._receiver_error = None
            raise error

    def _drain_results(self) -> list[ASRResult]:
        results: list[ASRResult] = []
        while not self._results.empty():
            results.append(self._results.get_nowait())
        return results

    @staticmethod
    def _decode_event(message: str | bytes) -> dict[str, Any]:
        if isinstance(message, bytes):
            message = message.decode("utf-8")
        event = json.loads(message)
        if not isinstance(event, dict):
            raise RuntimeError("DashScope ASR returned an invalid event")
        return event

    @staticmethod
    def _raise_for_error_event(event: dict[str, Any]) -> None:
        event_type = event.get("type")
        if event_type not in {
            "error",
            "conversation.item.input_audio_transcription.failed",
        }:
            return

        error = event.get("error", {})
        message = error.get("message", "Unknown DashScope ASR error")
        code = error.get("code")
        detail = f"{code}: {message}" if code else message
        raise RuntimeError(f"DashScope ASR error: {detail}")

    @staticmethod
    def _validate_chunk(chunk: ASRAudioChunk) -> None:
        if chunk.format != "pcm":
            raise ValueError("Qwen-ASR realtime only accepts pcm chunks")
        if chunk.sample_rate != 16000:
            raise ValueError("Qwen-ASR session is configured for 16000 Hz")

    @staticmethod
    def _language_code(language: str) -> str:
        return language.strip().lower().split("-", maxsplit=1)[0]

    @staticmethod
    def _event_id() -> str:
        return f"event_{uuid4().hex}"


def get_asr_provider(settings: Any) -> ASRProvider:
    api_key = getattr(settings, "dashscope_api_key", None)
    if api_key and api_key.strip():
        logger.info("使用 DashScope ASR Provider")
        return DashScopeASRProvider(api_key=api_key)
    logger.info("使用 Mock ASR Provider（未配置 DashScope API Key）")
    return MockASRProvider()

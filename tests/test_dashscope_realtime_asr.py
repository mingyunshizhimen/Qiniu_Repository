"""DashScope Qwen-ASR realtime WebSocket tests."""

import asyncio
import base64
import json
from collections import deque
from typing import Any

import pytest

from backend.app.providers.asr import DashScopeASRProvider
from backend.app.providers.base import (
    ASRAudioChunk,
    ASRResult,
    TranscriptType,
)


class FakeWebSocket:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.messages = deque(json.dumps(message) for message in messages)
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send(self, message: str) -> None:
        event = json.loads(message)
        self.sent.append(event)
        if event["type"] == "session.finish":
            self.messages.append(json.dumps({"type": "session.finished"}))

    async def recv(self) -> str:
        while not self.messages:
            await asyncio.sleep(0)
        return self.messages.popleft()

    async def close(self) -> None:
        self.closed = True


def session_messages() -> list[dict[str, Any]]:
    return [
        {"type": "session.created", "session": {"id": "session-1"}},
        {"type": "session.updated", "session": {"id": "session-1"}},
    ]


@pytest.mark.asyncio
async def test_initialize_configures_realtime_session() -> None:
    websocket = FakeWebSocket(session_messages())
    connection: dict[str, Any] = {}

    async def connect(url: str, **kwargs: Any) -> Any:
        connection["url"] = url
        connection["kwargs"] = kwargs
        return websocket

    provider = DashScopeASRProvider(api_key="test-key", connect=connect)

    await provider.initialize("zh-CN")

    assert connection["url"].endswith("?model=qwen3-asr-flash-realtime")
    assert connection["kwargs"]["additional_headers"] == {
        "Authorization": "Bearer test-key"
    }
    assert websocket.sent[0]["type"] == "session.update"
    assert websocket.sent[0]["session"] == {
        "input_audio_format": "pcm",
        "sample_rate": 16000,
        "input_audio_transcription": {"language": "zh"},
        "turn_detection": {
            "type": "server_vad",
            "threshold": 0.2,
            "silence_duration_ms": 400,
        },
    }

    await provider.finalize()


@pytest.mark.asyncio
async def test_send_audio_returns_partial_result() -> None:
    websocket = FakeWebSocket(
        session_messages()
        + [
            {
                "type": (
                    "conversation.item.input_audio_transcription.text"
                ),
                "text": "hello ",
                "stash": "world",
            },
        ]
    )

    async def connect(url: str, **kwargs: Any) -> Any:
        return websocket

    provider = DashScopeASRProvider(api_key="test-key", connect=connect)
    await provider.initialize("en-US")
    await asyncio.sleep(0)

    results = await provider.send_audio(
        ASRAudioChunk(data=b"\x01\x02", sample_rate=16000, format="pcm")
    )

    assert websocket.sent[1]["type"] == "input_audio_buffer.append"
    assert websocket.sent[1]["audio"] == base64.b64encode(
        b"\x01\x02"
    ).decode("ascii")
    assert results == [
        ASRResult(
            text="hello world",
            transcript_type=TranscriptType.PARTIAL,
            is_final=False,
            provider="dashscope",
        )
    ]

    await provider.finalize()


@pytest.mark.asyncio
async def test_finalize_returns_final_result_and_closes() -> None:
    websocket = FakeWebSocket(
        session_messages()
        + [
            {
                "type": (
                    "conversation.item.input_audio_transcription.completed"
                ),
                "transcript": "final text",
            },
        ]
    )

    async def connect(url: str, **kwargs: Any) -> Any:
        return websocket

    provider = DashScopeASRProvider(api_key="test-key", connect=connect)
    await provider.initialize("en-US")

    results = await provider.finalize()

    assert websocket.sent[-1]["type"] == "session.finish"
    assert results == [
        ASRResult(
            text="final text",
            transcript_type=TranscriptType.FINAL,
            is_final=True,
            provider="dashscope",
        )
    ]
    assert websocket.closed is True


@pytest.mark.asyncio
async def test_server_error_is_reported() -> None:
    websocket = FakeWebSocket(
        session_messages()
        + [
            {
                "type": "error",
                "error": {
                    "code": "invalid_request",
                    "message": "bad audio",
                },
            },
        ]
    )

    async def connect(url: str, **kwargs: Any) -> Any:
        return websocket

    provider = DashScopeASRProvider(api_key="test-key", connect=connect)
    await provider.initialize("en-US")
    await asyncio.sleep(0)

    with pytest.raises(RuntimeError, match="bad audio"):
        await provider.send_audio(ASRAudioChunk(data=b"\x00"))

    await provider.finalize()

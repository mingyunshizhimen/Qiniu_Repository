import base64
import json

import pytest

from backend.app.providers.base import TTSRequest
from backend.app.providers.tts import (
    DashScopeRealtimeTTSProvider,
    MockTTSProvider,
    get_tts_provider,
)


class FakeTTSWebSocket:
    def __init__(self) -> None:
        self.sent_messages: list[dict[str, object]] = []
        self.closed = False
        self.events = iter(
            [
                {"type": "session.created"},
                {"type": "session.updated"},
                {
                    "type": "response.audio.delta",
                    "delta": base64.b64encode(b"\x01\x02").decode("ascii"),
                },
                {"type": "response.done"},
                {"type": "session.finished"},
            ]
        )

    async def send(self, message: str) -> None:
        self.sent_messages.append(json.loads(message))

    async def recv(self) -> str:
        return json.dumps(next(self.events))

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_mock_tts_provider_returns_no_audio() -> None:
    provider = MockTTSProvider()

    result = await provider.synthesize(
        TTSRequest(text="Hello world", language="en-US")
    )

    assert result.provider == "mock"
    assert result.source_text == "Hello world"
    assert result.audio_chunks == []


def test_tts_provider_defaults_to_mock_without_key() -> None:
    class Settings:
        dashscope_api_key = None

    provider = get_tts_provider(Settings())

    assert isinstance(provider, MockTTSProvider)


@pytest.mark.asyncio
async def test_dashscope_tts_finishes_session_and_returns_audio() -> None:
    websocket = FakeTTSWebSocket()

    async def connect(*args: object, **kwargs: object) -> FakeTTSWebSocket:
        return websocket

    provider = DashScopeRealtimeTTSProvider(
        api_key="test-key",
        connect=connect,
    )

    result = await provider.synthesize(
        TTSRequest(text="Hello world", language="en-US")
    )

    sent_types = [message["type"] for message in websocket.sent_messages]
    assert sent_types == [
        "session.update",
        "input_text_buffer.append",
        "input_text_buffer.commit",
        "session.finish",
    ]
    assert result.audio_chunks == [b"\x01\x02"]
    assert result.provider == "dashscope"
    assert websocket.closed is True

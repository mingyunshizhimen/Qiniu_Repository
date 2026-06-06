import pytest

from backend.app.providers.base import TTSRequest
from backend.app.providers.tts import MockTTSProvider, get_tts_provider


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

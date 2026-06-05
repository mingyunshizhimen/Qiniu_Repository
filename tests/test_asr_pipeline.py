"""Realtime WebSocket and ASR provider integration tests."""

import base64

from fastapi.testclient import TestClient

from backend.app.api.realtime import get_realtime_asr_provider
from backend.app.main import app
from backend.app.providers.base import (
    ASRAudioChunk,
    ASRProvider,
    ASRResult,
    TranscriptType,
)


class FakeASRProvider(ASRProvider):
    def __init__(self) -> None:
        self.initialized_languages: list[str] = []
        self.chunks: list[ASRAudioChunk] = []
        self.finalize_count = 0

    async def initialize(self, language: str) -> None:
        self.initialized_languages.append(language)

    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        self.chunks.append(chunk)
        return [
            ASRResult(
                text="临时字幕",
                transcript_type=TranscriptType.PARTIAL,
                is_final=False,
                provider="fake",
            ),
            ASRResult(
                text="确认字幕",
                transcript_type=TranscriptType.FINAL,
                is_final=True,
                confidence=0.98,
                provider="fake",
            ),
        ]

    async def finalize(self) -> list[ASRResult]:
        self.finalize_count += 1
        return [
            ASRResult(
                text="结束时确认字幕",
                transcript_type=TranscriptType.FINAL,
                is_final=True,
                provider="fake",
            )
        ]


def command(
    command_type: str,
    sequence: int,
    payload: dict | None = None,
) -> dict:
    return {
        "version": "1.0",
        "type": command_type,
        "sequence": sequence,
        "payload": payload or {},
    }


def test_audio_pipeline_emits_partial_and_final_transcripts() -> None:
    provider = FakeASRProvider()
    app.dependency_overrides[get_realtime_asr_provider] = lambda: provider

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/v1/ws/sessions/audio-demo"
            ) as websocket:
                websocket.send_json(
                    command(
                        "session.start",
                        1,
                        {"source_language": "zh-CN"},
                    )
                )
                started = websocket.receive_json()

                audio = b"\x01\x02\x03\x04"
                websocket.send_json(
                    command(
                        "audio.append",
                        2,
                        {
                            "audio": base64.b64encode(audio).decode("ascii"),
                            "format": "pcm",
                            "sample_rate": 16000,
                        },
                    )
                )
                partial = websocket.receive_json()
                final = websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert started["payload"] == {"state": "active"}
    assert provider.initialized_languages == ["zh-CN"]
    assert provider.chunks == [
        ASRAudioChunk(data=audio, sample_rate=16000, format="pcm")
    ]
    assert partial["type"] == "transcript.partial"
    assert partial["payload"] == {
        "text": "临时字幕",
        "source": "asr",
        "provider": "fake",
    }
    assert final["type"] == "transcript.final"
    assert final["payload"] == {
        "text": "确认字幕",
        "source": "asr",
        "provider": "fake",
        "confidence": 0.98,
    }
    assert partial["trace_id"] == final["trace_id"]


def test_stop_flushes_final_result_before_stopped_state() -> None:
    provider = FakeASRProvider()
    app.dependency_overrides[get_realtime_asr_provider] = lambda: provider

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/v1/ws/sessions/audio-demo"
            ) as websocket:
                websocket.send_json(command("session.start", 1))
                websocket.receive_json()

                websocket.send_json(command("session.stop", 2))
                transcript = websocket.receive_json()
                stopped = websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert provider.finalize_count == 1
    assert transcript["type"] == "transcript.final"
    assert transcript["payload"]["text"] == "结束时确认字幕"
    assert stopped["type"] == "session.state"
    assert stopped["payload"] == {"state": "stopped"}


def test_invalid_audio_payload_returns_error_and_keeps_socket_open() -> None:
    provider = FakeASRProvider()
    app.dependency_overrides[get_realtime_asr_provider] = lambda: provider

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/v1/ws/sessions/audio-demo"
            ) as websocket:
                websocket.send_json(command("session.start", 1))
                websocket.receive_json()

                websocket.send_json(
                    command(
                        "audio.append",
                        2,
                        {"audio": "not-base64!", "format": "pcm"},
                    )
                )
                error = websocket.receive_json()

                websocket.send_json(command("session.pause", 3))
                paused = websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert error["type"] == "error"
    assert error["payload"]["code"] == "invalid_audio"
    assert provider.chunks == []
    assert paused["payload"] == {"state": "paused"}


def test_disconnect_finalizes_provider() -> None:
    provider = FakeASRProvider()
    app.dependency_overrides[get_realtime_asr_provider] = lambda: provider

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/v1/ws/sessions/audio-demo"
            ) as websocket:
                websocket.send_json(command("session.start", 1))
                websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert provider.finalize_count == 1

import base64

from fastapi.testclient import TestClient

from backend.app.api.realtime import (
    get_realtime_asr_provider,
    get_realtime_translation_provider,
)
from backend.app.main import app
from backend.app.providers.base import (
    ASRAudioChunk,
    ASRProvider,
    ASRResult,
    TranslationProvider,
    TranslationRequest,
    TranslationResult,
    TranscriptType,
)


class FakeASRProvider(ASRProvider):
    def __init__(self, final_text: str = "Complete semantic unit.") -> None:
        self.final_text = final_text
        self.initialized_languages: list[str] = []
        self.chunks: list[ASRAudioChunk] = []
        self.finalize_count = 0

    async def initialize(self, language: str) -> None:
        self.initialized_languages.append(language)

    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        self.chunks.append(chunk)
        return [
            ASRResult(
                text="live fragment",
                transcript_type=TranscriptType.PARTIAL,
                is_final=False,
                provider="fake",
            ),
            ASRResult(
                text=self.final_text,
                transcript_type=TranscriptType.FINAL,
                is_final=True,
                confidence=0.98,
                provider="fake",
            ),
        ]

    async def finalize(self) -> list[ASRResult]:
        self.finalize_count += 1
        return []


class FakeTranslationProvider(TranslationProvider):
    def __init__(self) -> None:
        self.requests: list[TranslationRequest] = []

    async def translate(self, request: TranslationRequest) -> TranslationResult:
        self.requests.append(request)
        return TranslationResult(
            translated_text=f"EN: {request.text}",
            source_text=request.text,
            provider="fake-translation",
        )


def command(command_type: str, sequence: int, payload: dict | None = None) -> dict:
    return {
        "version": "1.0",
        "type": command_type,
        "sequence": sequence,
        "payload": payload or {},
    }


def test_start_session_emits_active_state_event() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(
                command(
                    "session.start",
                    1,
                    {
                        "source_language": "zh-CN",
                        "target_language": "en-US",
                    },
                )
            )
            event = websocket.receive_json()

    assert event["type"] == "session.state"
    assert event["payload"] == {"state": "active"}
    assert event["session_id"] == "demo-session"
    assert event["sequence"] == 1


def test_audio_pipeline_emits_semantic_unit_and_translation_after_final_transcript() -> None:
    asr_provider = FakeASRProvider(final_text="Complete semantic unit.")
    translation_provider = FakeTranslationProvider()
    app.dependency_overrides[get_realtime_asr_provider] = lambda: asr_provider
    app.dependency_overrides[get_realtime_translation_provider] = (
        lambda: translation_provider
    )

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/v1/ws/sessions/audio-demo"
            ) as websocket:
                websocket.send_json(
                    command(
                        "session.start",
                        1,
                        {
                            "source_language": "en-US",
                            "target_language": "zh-CN",
                        },
                    )
                )
                websocket.receive_json()

                websocket.send_json(
                    command(
                        "audio.append",
                        2,
                        {
                            "audio": base64.b64encode(b"\x01\x02").decode("ascii"),
                            "format": "pcm",
                            "sample_rate": 16000,
                        },
                    )
                )
                partial = websocket.receive_json()
                transcript = websocket.receive_json()
                semantic_unit = websocket.receive_json()
                translation = websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert partial["type"] == "transcript.partial"
    assert transcript["type"] == "transcript.final"
    assert semantic_unit["type"] == "semantic_unit.final"
    assert semantic_unit["payload"] == {
        "text": "Complete semantic unit.",
        "source": "semantic",
        "provider": "heuristic",
    }
    assert translation["type"] == "translation.final"
    assert translation["payload"] == {
        "text": "EN: Complete semantic unit.",
        "source": "translation",
        "provider": "fake-translation",
        "source_text": "Complete semantic unit.",
    }
    assert translation["trace_id"] == semantic_unit["trace_id"]
    assert translation_provider.requests == [
        TranslationRequest(
            text="Complete semantic unit.",
            source_language="en-US",
            target_language="zh-CN",
            context=[],
        )
    ]


def test_incomplete_sentence_is_flushed_on_stop() -> None:
    translation_provider = FakeTranslationProvider()
    app.dependency_overrides[get_realtime_translation_provider] = (
        lambda: translation_provider
    )

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/v1/ws/sessions/demo-session"
            ) as websocket:
                websocket.send_json(command("session.start", 1))
                websocket.receive_json()

                websocket.send_json(
                    command("text.submit", 2, {"text": "buffered semantic fragment"})
                )
                partial = websocket.receive_json()
                transcript = websocket.receive_json()

                websocket.send_json(command("session.stop", 3))
                semantic_unit = websocket.receive_json()
                translation = websocket.receive_json()
                stopped = websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert partial["type"] == "transcript.partial"
    assert transcript["type"] == "transcript.final"
    assert semantic_unit["type"] == "semantic_unit.final"
    assert semantic_unit["payload"]["text"] == "buffered semantic fragment"
    assert translation["type"] == "translation.final"
    assert stopped["type"] == "session.state"
    assert stopped["payload"] == {"state": "stopped"}


def test_session_supports_pause_resume_and_stop() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(command("session.start", 1))
            assert websocket.receive_json()["payload"]["state"] == "active"

            websocket.send_json(command("session.pause", 2))
            paused = websocket.receive_json()

            websocket.send_json(command("session.resume", 3))
            resumed = websocket.receive_json()

            websocket.send_json(command("session.stop", 4))
            stopped = websocket.receive_json()

    assert paused["payload"] == {"state": "paused"}
    assert resumed["payload"] == {"state": "active"}
    assert stopped["payload"] == {"state": "stopped"}


def test_invalid_transition_returns_error_without_closing_socket() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(command("session.pause", 1))
            error = websocket.receive_json()

            websocket.send_json(command("session.start", 2))
            active = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"]["code"] == "invalid_transition"
    assert active["type"] == "session.state"
    assert active["payload"] == {"state": "active"}

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

    assert event["version"] == "1.0"
    assert event["type"] == "session.state"
    assert event["session_id"] == "demo-session"
    assert event["sequence"] == 1
    assert event["payload"] == {"state": "active"}
    assert event["trace_id"]
    assert event["timestamp"]


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

    assert paused["type"] == "session.state"
    assert paused["sequence"] == 2
    assert paused["payload"] == {"state": "paused"}
    assert resumed["sequence"] == 3
    assert resumed["payload"] == {"state": "active"}
    assert stopped["sequence"] == 4
    assert stopped["payload"] == {"state": "stopped"}


def test_invalid_transition_returns_error_without_closing_socket() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(command("session.pause", 1))
            error = websocket.receive_json()

            websocket.send_json(command("session.start", 2))
            active = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"] == {
        "code": "invalid_transition",
        "command": "session.pause",
        "current_state": "idle",
        "message": "Cannot handle session.pause while session is idle.",
    }
    assert active["type"] == "session.state"
    assert active["payload"] == {"state": "active"}


def test_text_submit_emits_partial_then_final_transcript() -> None:
    translation_provider = FakeTranslationProvider()
    app.dependency_overrides[get_realtime_translation_provider] = (
        lambda: translation_provider
    )

    with TestClient(app) as client:
        try:
            with client.websocket_connect(
                "/api/v1/ws/sessions/demo-session"
            ) as websocket:
                websocket.send_json(command("session.start", 1))
                websocket.receive_json()

                websocket.send_json(
                    command(
                        "text.submit",
                        2,
                        {"text": "我们使用七牛云对象存储。"},
                    )
                )
                partial = websocket.receive_json()
                final = websocket.receive_json()
                translation = websocket.receive_json()
        finally:
            app.dependency_overrides.clear()

    assert partial["type"] == "transcript.partial"
    assert partial["sequence"] == 2
    assert partial["payload"]["text"]
    assert partial["payload"]["text"] != final["payload"]["text"]
    assert partial["payload"]["source"] == "text_fallback"
    assert final["type"] == "transcript.final"
    assert final["sequence"] == 3
    assert final["payload"] == {
        "text": "我们使用七牛云对象存储。",
        "source": "text_fallback",
    }
    assert partial["trace_id"] == final["trace_id"]
    assert translation["type"] == "translation.final"
    assert translation["trace_id"] == final["trace_id"]
    assert translation["payload"]["source"] == "translation"
    assert translation["payload"]["text"] == "EN: 我们使用七牛云对象存储。"


def test_audio_final_transcript_triggers_translation_event() -> None:
    asr_provider = FakeASRProvider()
    translation_provider = FakeTranslationProvider()
    app.dependency_overrides[get_realtime_asr_provider] = lambda: asr_provider
    app.dependency_overrides[get_realtime_translation_provider] = (
        lambda: translation_provider
    )

    try:
        with TestClient(app) as client:
            with client.websocket_connect("/api/v1/ws/sessions/audio-demo") as websocket:
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
                websocket.receive_json()
                transcript = websocket.receive_json()
                translation = websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert transcript["type"] == "transcript.final"
    assert translation["type"] == "translation.final"
    assert translation["payload"] == {
        "text": "EN: 确认字幕",
        "source": "translation",
        "provider": "fake-translation",
        "source_text": "确认字幕",
    }
    assert translation["trace_id"] == transcript["trace_id"]
    assert translation_provider.requests == [
        TranslationRequest(
            text="确认字幕",
            source_language="zh-CN",
            target_language="en-US",
            context=[],
        )
    ]


def test_text_submit_is_rejected_while_paused() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(command("session.start", 1))
            websocket.receive_json()
            websocket.send_json(command("session.pause", 2))
            websocket.receive_json()

            websocket.send_json(command("text.submit", 3, {"text": "不会被处理"}))
            error = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"]["code"] == "invalid_transition"
    assert error["payload"]["command"] == "text.submit"
    assert error["payload"]["current_state"] == "paused"


def test_empty_text_returns_error_and_connection_stays_open() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(command("session.start", 1))
            websocket.receive_json()

            websocket.send_json(command("text.submit", 2, {"text": "  "}))
            error = websocket.receive_json()

            websocket.send_json(command("text.submit", 3, {"text": "连接仍然可用"}))
            partial = websocket.receive_json()
            final = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"] == {
        "code": "invalid_payload",
        "command": "text.submit",
        "message": "text.submit requires non-empty text.",
    }
    assert partial["type"] == "transcript.partial"
    assert final["type"] == "transcript.final"


def test_invalid_message_returns_error_and_connection_stays_open() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(
                {
                    "version": "2.0",
                    "type": "session.start",
                    "sequence": 1,
                    "payload": {},
                }
            )
            error = websocket.receive_json()

            websocket.send_json(command("session.start", 2))
            active = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"]["code"] == "invalid_message"
    assert error["payload"]["message"] == "Message does not match protocol v1.0."
    assert active["type"] == "session.state"
    assert active["payload"] == {"state": "active"}


def test_duplicate_command_sequence_is_rejected_without_state_change() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/sessions/demo-session") as websocket:
            websocket.send_json(command("session.start", 1))
            websocket.receive_json()

            websocket.send_json(command("session.pause", 1))
            error = websocket.receive_json()

            websocket.send_json(command("session.pause", 2))
            paused = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"] == {
        "code": "invalid_sequence",
        "received": 1,
        "last_received": 1,
        "message": "Command sequence must increase monotonically.",
    }
    assert paused["type"] == "session.state"
    assert paused["payload"] == {"state": "paused"}

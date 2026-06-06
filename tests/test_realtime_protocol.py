import asyncio
import base64

from fastapi.testclient import TestClient

from backend.app.api.realtime import (
    get_realtime_asr_provider,
    get_realtime_translation_provider,
    get_realtime_tts_provider,
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
    TTSProvider,
    TTSRequest,
    TTSResult,
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


class FakeTTSProvider(TTSProvider):
    def __init__(self) -> None:
        self.requests: list[TTSRequest] = []

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        self.requests.append(request)
        return TTSResult(
            audio_chunks=[b"\x01\x02", b"\x03\x04"],
            source_text=request.text,
            provider="fake-tts",
            voice=request.voice,
            response_format=request.response_format,
            sample_rate=request.sample_rate,
        )


class SlowTTSProvider(FakeTTSProvider):
    async def synthesize(self, request: TTSRequest) -> TTSResult:
        await asyncio.sleep(0.01)
        return await super().synthesize(request)


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


def test_playback_enabled_emits_tts_audio_events() -> None:
    asr_provider = FakeASRProvider(final_text="Complete semantic unit.")
    translation_provider = FakeTranslationProvider()
    tts_provider = FakeTTSProvider()
    app.dependency_overrides[get_realtime_asr_provider] = lambda: asr_provider
    app.dependency_overrides[get_realtime_translation_provider] = (
        lambda: translation_provider
    )
    app.dependency_overrides[get_realtime_tts_provider] = lambda: tts_provider

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
                        "speech.playback.set",
                        2,
                        {"enabled": True},
                    )
                )
                playback_state = websocket.receive_json()

                websocket.send_json(
                    command(
                        "audio.append",
                        3,
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
                started = websocket.receive_json()
                delta_1 = websocket.receive_json()
                delta_2 = websocket.receive_json()
                finished = websocket.receive_json()
    finally:
        app.dependency_overrides.clear()

    assert playback_state["type"] == "speech.playback.state"
    assert playback_state["payload"] == {"enabled": True}
    assert partial["type"] == "transcript.partial"
    assert transcript["type"] == "transcript.final"
    assert semantic_unit["type"] == "semantic_unit.final"
    assert translation["type"] == "translation.final"
    assert started["type"] == "speech.playback.started"
    assert delta_1["type"] == "tts.audio.delta"
    assert delta_2["type"] == "tts.audio.delta"
    assert finished["type"] == "speech.playback.finished"
    assert delta_1["payload"]["audio"] == base64.b64encode(b"\x01\x02").decode(
        "ascii"
    )
    assert delta_2["payload"]["audio"] == base64.b64encode(b"\x03\x04").decode(
        "ascii"
    )
    assert tts_provider.requests == [
        TTSRequest(
            text="EN: Complete semantic unit.",
            language="zh-CN",
            voice="Cherry",
            response_format="pcm",
            sample_rate=24000,
        )
    ]


def test_playback_events_do_not_block_translation_delivery() -> None:
    asr_provider = FakeASRProvider(final_text="Complete semantic unit.")
    translation_provider = FakeTranslationProvider()
    tts_provider = SlowTTSProvider()
    emitted_events: list[str] = []

    async def enqueue_event(event):
        emitted_events.append(event.type)

    from backend.app.realtime.pipeline import RealtimeASRPipeline
    from backend.app.realtime.session import RealtimeSession

    async def run_pipeline() -> list[str]:
        session = RealtimeSession("audio-demo")
        pipeline = RealtimeASRPipeline(
            session,
            asr_provider,
            translation_provider,
            tts_provider,
            event_sink=enqueue_event,
        )

        await pipeline.handle(command("session.start", 1))
        events = await pipeline.handle(
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
        await asyncio.sleep(0.05)
        await pipeline.close()
        return [event.type for event in events]

    event_types = asyncio.run(run_pipeline())

    assert event_types == [
        "transcript.partial",
        "transcript.final",
        "semantic_unit.final",
        "translation.final",
    ]
    assert "speech.playback.started" in emitted_events
    assert "tts.audio.delta" in emitted_events
    assert "speech.playback.finished" in emitted_events


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

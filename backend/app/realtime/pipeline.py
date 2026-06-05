"""ASR lifecycle and realtime protocol orchestration."""

import base64
import binascii
from uuid import uuid4

from backend.app.providers.base import (
    ASRAudioChunk,
    ASRProvider,
    ASRResult,
    TranslationProvider,
    TranslationRequest,
    TranslationResult,
)
from backend.app.realtime.models import ClientCommand, ServerEvent
from backend.app.realtime.session import RealtimeSession


class RealtimeASRPipeline:
    def __init__(
        self,
        session: RealtimeSession,
        provider: ASRProvider,
        translation_provider: TranslationProvider,
    ) -> None:
        self._session = session
        self._provider = provider
        self._translation_provider = translation_provider
        self._provider_initialized = False
        self._provider_finalized = False
        self._source_language = "zh-CN"
        self._target_language = "en-US"
        self._confirmed_transcripts: list[str] = []

    async def handle(self, command: ClientCommand) -> list[ServerEvent]:
        if command.type == "audio.append":
            return await self._handle_audio(command)

        events = self._session.handle(command)
        if self._has_error(events):
            return events

        if command.type == "session.start":
            self._source_language = str(
                command.payload.get("source_language", "zh-CN")
            ).strip() or "zh-CN"
            self._target_language = str(
                command.payload.get("target_language", "en-US")
            ).strip() or "en-US"
            try:
                await self._provider.initialize(self._source_language)
            except Exception as exc:
                self._session.state = "idle"
                return [
                    self._error_event(
                        "asr_initialization_failed",
                        str(exc),
                    )
                ]
            self._provider_initialized = True
            self._provider_finalized = False

        if command.type == "session.stop" and self._provider_initialized:
            results = await self._finalize_provider()
            transcript_events = self._transcript_events(results)
            return await self._with_translation(transcript_events) + events

        return await self._with_translation(events)

    async def close(self) -> None:
        if self._provider_initialized and not self._provider_finalized:
            await self._finalize_provider()

    async def _handle_audio(
        self,
        command: ClientCommand,
    ) -> list[ServerEvent]:
        trace_id, error = self._session.accept_audio_command(command)
        if error is not None:
            return [error]

        try:
            chunk = self._decode_audio_chunk(command)
            results = await self._provider.send_audio(chunk)
        except (ValueError, binascii.Error) as exc:
            return [
                self._error_event(
                    "invalid_audio",
                    str(exc),
                    trace_id=trace_id,
                )
            ]
        except Exception as exc:
            return [
                self._error_event(
                    "asr_provider_error",
                    str(exc),
                    trace_id=trace_id,
                )
            ]

        transcript_events = self._transcript_events(results, trace_id)
        return await self._with_translation(transcript_events)

    async def _finalize_provider(self) -> list[ASRResult]:
        if self._provider_finalized:
            return []
        self._provider_finalized = True
        return await self._provider.finalize()

    def _decode_audio_chunk(
        self,
        command: ClientCommand,
    ) -> ASRAudioChunk:
        encoded_audio = command.payload.get("audio")
        if not isinstance(encoded_audio, str) or not encoded_audio:
            raise ValueError("audio.append requires Base64 audio")

        audio = base64.b64decode(encoded_audio, validate=True)
        if not audio:
            raise ValueError("audio.append decoded to an empty chunk")

        sample_rate = command.payload.get("sample_rate", 16000)
        if not isinstance(sample_rate, int) or sample_rate <= 0:
            raise ValueError("sample_rate must be a positive integer")

        audio_format = command.payload.get("format", "pcm")
        if not isinstance(audio_format, str) or not audio_format:
            raise ValueError("format must be a non-empty string")

        return ASRAudioChunk(
            data=audio,
            sample_rate=sample_rate,
            format=audio_format,
        )

    def _transcript_events(
        self,
        results: list[ASRResult],
        trace_id: str | None = None,
    ) -> list[ServerEvent]:
        trace_id = trace_id or str(uuid4())
        events: list[ServerEvent] = []
        for result in results:
            payload = {
                "text": result.text,
                "source": "asr",
                "provider": result.provider,
            }
            if result.confidence is not None:
                payload["confidence"] = result.confidence

            events.append(
                self._session.event(
                    event_type=(
                        "transcript.final"
                        if result.is_final
                        else "transcript.partial"
                    ),
                    trace_id=trace_id,
                    payload=payload,
                )
            )
        return events

    async def _with_translation(
        self,
        transcript_events: list[ServerEvent],
    ) -> list[ServerEvent]:
        events: list[ServerEvent] = []
        for event in transcript_events:
            events.append(event)
            if event.type != "transcript.final":
                continue

            text = str(event.payload.get("text", "")).strip()
            if not text:
                continue

            translated_event = await self._translate_event(event, text)
            if translated_event is not None:
                events.append(translated_event)
            self._confirmed_transcripts.append(text)
        return events

    async def _translate_event(
        self,
        transcript_event: ServerEvent,
        text: str,
    ) -> ServerEvent | None:
        try:
            result: TranslationResult = await self._translation_provider.translate(
                TranslationRequest(
                    text=text,
                    source_language=self._source_language,
                    target_language=self._target_language,
                    context=self._confirmed_transcripts[-5:],
                )
            )
        except Exception as exc:
            return self._error_event("translation_failed", str(exc), transcript_event.trace_id)

        return self._session.event(
            event_type="translation.final",
            trace_id=transcript_event.trace_id,
            payload={
                "text": result.translated_text,
                "source": "translation",
                "provider": result.provider,
                "source_text": result.source_text,
            },
        )

    def _error_event(
        self,
        code: str,
        message: str,
        trace_id: str | None = None,
    ) -> ServerEvent:
        return self._session.event(
            event_type="error",
            trace_id=trace_id or str(uuid4()),
            payload={"code": code, "message": message},
        )

    @staticmethod
    def _has_error(events: list[ServerEvent]) -> bool:
        return any(event.type == "error" for event in events)

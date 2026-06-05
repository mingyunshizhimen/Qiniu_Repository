"""ASR lifecycle and realtime protocol orchestration."""

import base64
import binascii
from uuid import uuid4

from backend.app.providers.base import (
    ASRAudioChunk,
    ASRProvider,
    ASRResult,
)
from backend.app.realtime.models import ClientCommand, ServerEvent
from backend.app.realtime.session import RealtimeSession


class RealtimeASRPipeline:
    def __init__(
        self,
        session: RealtimeSession,
        provider: ASRProvider,
    ) -> None:
        self._session = session
        self._provider = provider
        self._provider_initialized = False
        self._provider_finalized = False

    async def handle(self, command: ClientCommand) -> list[ServerEvent]:
        if command.type == "audio.append":
            return await self._handle_audio(command)

        events = self._session.handle(command)
        if self._has_error(events):
            return events

        if command.type == "session.start":
            language = str(
                command.payload.get("source_language", "zh-CN")
            ).strip() or "zh-CN"
            try:
                await self._provider.initialize(language)
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
            return self._transcript_events(results) + events

        return events

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

        return self._transcript_events(results, trace_id)

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

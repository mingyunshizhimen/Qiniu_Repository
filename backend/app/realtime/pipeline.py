"""ASR lifecycle and realtime protocol orchestration."""

import asyncio
import base64
import binascii
import logging
from collections.abc import Awaitable, Callable
from uuid import uuid4

from backend.app.providers.base import (
    ASRAudioChunk,
    ASRProvider,
    ASRResult,
    GlossaryConstraint,
    TranslationProvider,
    TranslationRequest,
    TranslationResult,
    TTSProvider,
    TTSRequest,
)
from backend.app.realtime.models import ClientCommand, ServerEvent
from backend.app.realtime.semantic import SemanticSegmenter
from backend.app.realtime.session import RealtimeSession
from backend.app.services.glossary import GlossaryService, get_glossary_service

logger = logging.getLogger(__name__)


class RealtimeASRPipeline:
    def __init__(
        self,
        session: RealtimeSession,
        provider: ASRProvider,
        translation_provider: TranslationProvider,
        tts_provider: TTSProvider,
        event_sink: Callable[[ServerEvent], Awaitable[None]] | None = None,
        glossary_service: GlossaryService | None = None,
    ) -> None:
        self._session = session
        self._provider = provider
        self._translation_provider = translation_provider
        self._tts_provider = tts_provider
        self._event_sink = event_sink
        self._glossary_service = glossary_service or get_glossary_service()
        self._provider_initialized = False
        self._provider_finalized = False
        self._source_language = "zh-CN"
        self._target_language = "en-US"
        self._confirmed_transcripts: list[str] = []
        self._segmenter = SemanticSegmenter()
        self._pending_segment_trace_id: str | None = None
        self._playback_tasks: set[asyncio.Task[None]] = set()
        self._preview_translation_tasks: set[asyncio.Task[None]] = set()
        self._final_translation_tasks: set[asyncio.Task[None]] = set()
        self._final_translation_lock = asyncio.Lock()
        self._preview_translation_revision = 0
        self._last_partial_translation_text = ""

    async def handle(self, command: ClientCommand) -> list[ServerEvent]:
        if command.type == "audio.append":
            return await self._handle_audio(command)

        events = self._session.handle(command)
        if self._has_error(events):
            return events

        if command.type == "speech.playback.set":
            enabled = command.payload.get("enabled")
            if isinstance(enabled, bool) and not enabled:
                logger.info(
                    "Speech playback disabled; cancelling pending playback tasks for session %s",
                    self._session.session_id,
                )
                self._cancel_playback_tasks()

        if command.type == "session.start":
            self._cancel_preview_translation_tasks()
            self._cancel_final_translation_tasks()
            self._source_language = str(
                command.payload.get("source_language", "zh-CN")
            ).strip() or "zh-CN"
            self._target_language = str(
                command.payload.get("target_language", "en-US")
            ).strip() or "en-US"
            self._segmenter.reset()
            self._pending_segment_trace_id = None
            self._confirmed_transcripts.clear()
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
            semantic_events = await self._semantic_translation_events(
                transcript_events,
                force_flush=True,
            )
            self._cancel_preview_translation_tasks()
            await self._wait_for_final_translation_tasks()
            self._cancel_playback_tasks()
            return semantic_events + events

        return await self._semantic_translation_events(events)

    async def close(self) -> None:
        self._cancel_preview_translation_tasks()
        self._cancel_final_translation_tasks()
        self._cancel_playback_tasks()
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
        return await self._semantic_translation_events(transcript_events)

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

    async def _semantic_translation_events(
        self,
        transcript_events: list[ServerEvent],
        force_flush: bool = False,
    ) -> list[ServerEvent]:
        events: list[ServerEvent] = []
        last_trace_id: str | None = None

        for event in transcript_events:
            events.append(event)
            if event.type != "transcript.final":
                if event.type == "transcript.partial":
                    partial_text = str(event.payload.get("text", "")).strip()
                    if partial_text and partial_text != self._last_partial_translation_text:
                        if self._event_sink is None:
                            preview_event = await self._translate_preview_event(
                                event,
                                partial_text,
                            )
                            if preview_event is not None:
                                events.append(preview_event)
                        else:
                            self._schedule_preview_translation_event(
                                event,
                                partial_text,
                            )
                        self._last_partial_translation_text = partial_text
                continue

            text = str(event.payload.get("text", "")).strip()
            if not text:
                continue

            last_trace_id = event.trace_id
            if self._pending_segment_trace_id is None:
                self._pending_segment_trace_id = event.trace_id

            semantic_units = self._segmenter.push(text)
            events.extend(
                await self._emit_semantic_units(
                    semantic_units,
                    event.trace_id,
                    publish_translation_in_background=(
                        self._event_sink is not None and not force_flush
                    ),
                )
            )

        if force_flush:
            flush_trace_id = last_trace_id or str(uuid4())
            events.extend(
                await self._emit_semantic_units(
                    self._segmenter.flush(),
                    flush_trace_id,
                    publish_translation_in_background=False,
                )
            )

        if self._segmenter.is_empty():
            self._pending_segment_trace_id = None

        return events

    async def _emit_semantic_units(
        self,
        semantic_units: list[str],
        trace_id: str,
        publish_translation_in_background: bool = False,
    ) -> list[ServerEvent]:
        events: list[ServerEvent] = []
        for semantic_unit in semantic_units:
            emitted_text = semantic_unit.strip()
            if not emitted_text:
                continue

            semantic_trace_id = self._pending_segment_trace_id or trace_id
            semantic_event = self._session.event(
                event_type="semantic_unit.final",
                trace_id=semantic_trace_id,
                payload={
                    "text": emitted_text,
                    "source": "semantic",
                    "provider": "heuristic",
                },
            )
            events.append(semantic_event)

            if publish_translation_in_background:
                self._cancel_preview_translation_tasks()
                self._schedule_final_translation_event(
                    semantic_event,
                    emitted_text,
                )
                continue

            translated_event = await self._translate_event(
                semantic_event,
                emitted_text,
            )
            if translated_event is not None:
                events.extend(
                    await self._complete_final_translation(
                        translated_event,
                        emitted_text,
                    )
                )

        return events

    async def _translate_event(
        self,
        semantic_event: ServerEvent,
        text: str,
    ) -> ServerEvent | None:
        glossary_matches = self._glossary_service.match_terms(text)
        glossary_constraints = [
            GlossaryConstraint(
                source_term=term.source_term,
                target_term=term.target_term,
                start_index=start_index,
            )
            for term, start_index in glossary_matches
        ]
        try:
            result: TranslationResult = await self._translation_provider.translate(
                TranslationRequest(
                    text=text,
                    source_language=self._source_language,
                    target_language=self._target_language,
                    context=self._confirmed_transcripts[-5:],
                    glossary_terms=glossary_constraints,
                )
            )
        except Exception as exc:
            return self._error_event(
                "translation_failed",
                str(exc),
                semantic_event.trace_id,
            )

        return self._session.event(
            event_type="translation.final",
            trace_id=semantic_event.trace_id,
            payload={
                "text": result.translated_text,
                "source": "translation",
                "provider": result.provider,
                "source_text": result.source_text,
                "term_hits": [
                    {
                        "source_term": constraint.source_term,
                        "target_term": constraint.target_term,
                        "start_index": constraint.start_index,
                    }
                    for constraint in glossary_constraints
                ],
            },
        )

    async def _translate_preview_event(
        self,
        transcript_event: ServerEvent,
        text: str,
    ) -> ServerEvent | None:
        glossary_matches = self._glossary_service.match_terms(text)
        glossary_constraints = [
            GlossaryConstraint(
                source_term=term.source_term,
                target_term=term.target_term,
                start_index=start_index,
            )
            for term, start_index in glossary_matches
        ]
        try:
            result: TranslationResult = await self._translation_provider.translate(
                TranslationRequest(
                    text=text,
                    source_language=self._source_language,
                    target_language=self._target_language,
                    context=self._confirmed_transcripts[-5:],
                    glossary_terms=glossary_constraints,
                )
            )
        except Exception as exc:
            logger.debug(
                "Preview translation failed for session %s trace=%s: %s",
                self._session.session_id,
                transcript_event.trace_id,
                exc,
            )
            return None

        return self._session.event(
            event_type="translation.partial",
            trace_id=transcript_event.trace_id,
            payload={
                "text": result.translated_text,
                "source": "translation",
                "provider": result.provider,
                "source_text": result.source_text,
                "term_hits": [
                    {
                        "source_term": constraint.source_term,
                        "target_term": constraint.target_term,
                        "start_index": constraint.start_index,
                    }
                    for constraint in glossary_constraints
                ],
            },
        )

    async def _complete_final_translation(
        self,
        translated_event: ServerEvent,
        source_text: str,
    ) -> list[ServerEvent]:
        self._confirmed_transcripts.append(source_text)
        self._preview_translation_revision = 0
        self._last_partial_translation_text = ""

        logger.info(
            "Translation finalized for session %s trace=%s playback=%s text=%s",
            self._session.session_id,
            translated_event.trace_id,
            self._session.speech_playback_enabled,
            str(translated_event.payload.get("text", "")).strip()[:120],
        )

        events = [translated_event]
        if self._event_sink is None:
            events.extend(
                await self._playback_events(
                    translated_event,
                    source_text,
                )
            )
        else:
            self._schedule_playback_events(
                translated_event,
                source_text,
            )
        return events

    def _schedule_final_translation_event(
        self,
        semantic_event: ServerEvent,
        text: str,
    ) -> None:
        task = asyncio.create_task(
            self._publish_final_translation_event(
                semantic_event,
                text,
            )
        )
        self._final_translation_tasks.add(task)
        task.add_done_callback(self._final_translation_tasks.discard)

    async def _publish_final_translation_event(
        self,
        semantic_event: ServerEvent,
        text: str,
    ) -> None:
        if self._event_sink is None:
            return

        try:
            async with self._final_translation_lock:
                translated_event = await self._translate_event(
                    semantic_event,
                    text,
                )
                if translated_event is None:
                    return
                events = await self._complete_final_translation(
                    translated_event,
                    text,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "Async final translation failed for session %s trace=%s: %s",
                self._session.session_id,
                semantic_event.trace_id,
                exc,
            )
            events = [
                self._error_event(
                    "translation_failed",
                    str(exc),
                    semantic_event.trace_id,
                )
            ]

        for event in events:
            await self._event_sink(event)

    def _schedule_preview_translation_event(
        self,
        transcript_event: ServerEvent,
        text: str,
    ) -> None:
        self._cancel_preview_translation_tasks()
        self._preview_translation_revision += 1
        revision = self._preview_translation_revision
        task = asyncio.create_task(
            self._publish_preview_translation_event(
                transcript_event,
                text,
                revision,
            )
        )
        self._preview_translation_tasks.add(task)
        task.add_done_callback(self._preview_translation_tasks.discard)

    async def _publish_preview_translation_event(
        self,
        transcript_event: ServerEvent,
        text: str,
        revision: int,
    ) -> None:
        if self._event_sink is None:
            return

        try:
            await asyncio.sleep(0.15)
            preview_event = await self._translate_preview_event(
                transcript_event,
                text,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug(
                "Preview translation task failed for session %s trace=%s: %s",
                self._session.session_id,
                transcript_event.trace_id,
                exc,
            )
            return

        if preview_event is None:
            return
        if revision != self._preview_translation_revision:
            logger.debug(
                "Discarding stale preview translation for session %s trace=%s revision=%s current=%s",
                self._session.session_id,
                transcript_event.trace_id,
                revision,
                self._preview_translation_revision,
            )
            return

        await self._event_sink(preview_event)

    async def _playback_events(
        self,
        translation_event: ServerEvent,
        source_text: str,
    ) -> list[ServerEvent]:
        if not self._session.speech_playback_enabled:
            return []

        playback_text = str(translation_event.payload.get("text", "")).strip()
        if not playback_text:
            return []

        started_event = self._session.event(
            event_type="speech.playback.started",
            trace_id=translation_event.trace_id,
            payload={
                "text": playback_text,
                "source_text": source_text,
                "source": "tts",
            },
        )

        try:
            logger.info(
                "TTS playback started for session %s trace=%s text=%s",
                self._session.session_id,
                translation_event.trace_id,
                playback_text[:120],
            )
            result = await self._tts_provider.synthesize(
                TTSRequest(
                    text=playback_text,
                    language=self._target_language,
                )
            )
        except Exception as exc:
            failed_event = self._session.event(
                event_type="speech.playback.failed",
                trace_id=translation_event.trace_id,
                payload={
                    "text": playback_text,
                    "source_text": source_text,
                    "source": "tts",
                    "message": str(exc),
                },
            )
            logger.warning(
                "TTS playback failed for session %s trace=%s: %s",
                self._session.session_id,
                translation_event.trace_id,
                exc,
            )
            return [started_event, failed_event]

        events: list[ServerEvent] = [started_event]
        for chunk in result.audio_chunks:
            encoded_audio = base64.b64encode(chunk).decode("ascii")
            events.append(
                self._session.event(
                    event_type="tts.audio.delta",
                    trace_id=translation_event.trace_id,
                    payload={
                        "text": playback_text,
                        "source_text": source_text,
                        "audio": encoded_audio,
                        "format": result.response_format,
                        "sample_rate": result.sample_rate,
                        "voice": result.voice,
                        "source": "tts",
                        "provider": result.provider,
                    },
                )
            )

        logger.info(
            "TTS playback finished for session %s trace=%s chunks=%s provider=%s",
            self._session.session_id,
            translation_event.trace_id,
            len(result.audio_chunks),
            result.provider,
        )
        events.append(
            self._session.event(
                event_type="speech.playback.finished",
                trace_id=translation_event.trace_id,
                payload={
                    "text": playback_text,
                    "source_text": source_text,
                    "source": "tts",
                    "provider": result.provider,
                    "chunks": len(result.audio_chunks),
                },
            )
        )
        return events

    def _schedule_playback_events(
        self,
        translation_event: ServerEvent,
        source_text: str,
    ) -> None:
        task = asyncio.create_task(
            self._publish_playback_events(translation_event, source_text)
        )
        self._playback_tasks.add(task)
        task.add_done_callback(self._playback_tasks.discard)

    async def _publish_playback_events(
        self,
        translation_event: ServerEvent,
        source_text: str,
    ) -> None:
        if self._event_sink is None or not self._session.speech_playback_enabled:
            return

        try:
            events = await self._playback_events(translation_event, source_text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "Async TTS playback task failed for session %s trace=%s: %s",
                self._session.session_id,
                translation_event.trace_id,
                exc,
            )
            events = [
                self._session.event(
                    event_type="speech.playback.failed",
                    trace_id=translation_event.trace_id,
                    payload={
                        "text": str(translation_event.payload.get("text", "")).strip(),
                        "source_text": source_text,
                        "source": "tts",
                        "message": str(exc),
                    },
                )
            ]

        if not self._session.speech_playback_enabled:
            return

        for event in events:
            if not self._session.speech_playback_enabled:
                return
            await self._event_sink(event)

    def _cancel_playback_tasks(self) -> None:
        for task in list(self._playback_tasks):
            task.cancel()
        self._playback_tasks.clear()

    def _cancel_preview_translation_tasks(self) -> None:
        for task in list(self._preview_translation_tasks):
            task.cancel()
        self._preview_translation_tasks.clear()

    def _cancel_final_translation_tasks(self) -> None:
        for task in list(self._final_translation_tasks):
            task.cancel()
        self._final_translation_tasks.clear()

    async def _wait_for_final_translation_tasks(self) -> None:
        tasks = list(self._final_translation_tasks)
        if not tasks:
            return
        await asyncio.gather(*tasks, return_exceptions=True)

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

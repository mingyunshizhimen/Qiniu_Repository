"""Shared provider contracts for ASR, translation, and TTS."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum


class TranscriptType(str, Enum):
    """Classification of transcript updates emitted by the ASR provider."""

    PARTIAL = "partial"
    FINAL = "final"


@dataclass(frozen=True)
class GlossaryConstraint:
    """A structured terminology constraint attached to a translation request."""

    source_term: str
    target_term: str
    start_index: int


@dataclass
class TranslationRequest:
    """Input for the translation provider."""

    text: str
    source_language: str
    target_language: str
    context: list[str] = field(default_factory=list)
    glossary_terms: list[GlossaryConstraint] = field(default_factory=list)


@dataclass
class TranslationResult:
    """Output from the translation provider."""

    translated_text: str
    source_text: str
    provider: str


@dataclass
class ASRAudioChunk:
    """Audio payload delivered from the browser to the ASR provider."""

    data: bytes
    sample_rate: int = 16000
    format: str = "pcm"


@dataclass
class ASRResult:
    """Recognition result emitted by the ASR provider."""

    text: str
    transcript_type: TranscriptType
    is_final: bool
    confidence: float | None = None
    provider: str = "mock"


class TranslationProvider(ABC):
    """Contract implemented by translation providers."""

    @abstractmethod
    async def translate(self, request: TranslationRequest) -> TranslationResult:
        """Translate input text and return the translated result."""


class ASRProvider(ABC):
    """Contract implemented by realtime ASR providers."""

    @abstractmethod
    async def initialize(self, language: str) -> None:
        """Initialize the provider for a new realtime session."""

    @abstractmethod
    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        """Process an audio chunk and return partial and/or final transcript results."""

    @abstractmethod
    async def finalize(self) -> list[ASRResult]:
        """Flush any buffered final transcript results and close the provider session."""


@dataclass
class TTSRequest:
    """Input for the TTS provider."""

    text: str
    language: str
    voice: str = "Cherry"
    response_format: str = "pcm"
    sample_rate: int = 24000


@dataclass
class TTSResult:
    """Output from the TTS provider."""

    audio_chunks: list[bytes] = field(default_factory=list)
    source_text: str = ""
    provider: str = "mock"
    voice: str = "Cherry"
    response_format: str = "pcm"
    sample_rate: int = 24000


class TTSProvider(ABC):
    """Contract implemented by TTS providers."""

    @abstractmethod
    async def synthesize(self, request: TTSRequest) -> TTSResult:
        """Synthesize speech and return audio chunks."""

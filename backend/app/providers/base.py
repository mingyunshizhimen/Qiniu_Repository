"""AI Provider 抽象基类，定义翻译和 ASR 的窄接口。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum


class TranscriptType(str, Enum):
    """转写结果类型"""
    PARTIAL = "partial"   # 临时结果，可能变化
    FINAL = "final"       # 确认结果，不再变化


@dataclass
class TranslationRequest:
    """翻译请求"""
    text: str
    source_language: str  # BCP 47, e.g. "zh-CN"
    target_language: str  # BCP 47, e.g. "en-US"
    context: list[str] = field(default_factory=list)  # 最近若干条确认译文，用于上下文一致性


@dataclass
class TranslationResult:
    """翻译结果"""
    translated_text: str
    source_text: str
    provider: str  # "mock" | "dashscope"


@dataclass
class ASRAudioChunk:
    """音频数据块"""
    data: bytes           # 音频原始字节（PCM 或 Opus）
    sample_rate: int = 16000  # 采样率
    format: str = "pcm"       # 格式：pcm / opus / wav


@dataclass
class ASRResult:
    """ASR 转写结果"""
    text: str                    # 转写文本
    transcript_type: TranscriptType  # 临时或确认
    is_final: bool               # 是否最终结果（等同于 transcript_type == FINAL）
    confidence: float | None = None  # 可选的置信度（0-1）
    provider: str = "mock"       # "mock" | "dashscope"


class TranslationProvider(ABC):
    """翻译 Provider 抽象接口"""

    @abstractmethod
    async def translate(self, request: TranslationRequest) -> TranslationResult:
        """执行翻译，返回结果"""
        ...


class ASRProvider(ABC):
    """语音识别 Provider 抽象接口"""

    @abstractmethod
    async def initialize(self, language: str) -> None:
        """
        初始化 ASR 会话

        Args:
            language: 源语言 BCP 47 代码，如 "zh-CN"
        """
        ...

    @abstractmethod
    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        """
        发送音频块，返回识别结果列表

        可能返回空列表（无新结果）、一个 partial、一个 final，
        或多个结果（取决于 Provider 实现）。

        Args:
            chunk: 音频数据块

        Returns:
            识别结果列表，按时间顺序排列
        """
        ...

    @abstractmethod
    async def finalize(self) -> list[ASRResult]:
        """
        结束当前会话，强制输出所有缓冲中的 final 结果

        Returns:
            剩余的最终识别结果列表
        """
        ...
@dataclass
class TTSRequest:
    """语音合成请求"""

    text: str
    language: str
    voice: str = "Cherry"
    response_format: str = "pcm"
    sample_rate: int = 24000


@dataclass
class TTSResult:
    """语音合成结果"""

    audio_chunks: list[bytes] = field(default_factory=list)
    source_text: str = ""
    provider: str = "mock"
    voice: str = "Cherry"
    response_format: str = "pcm"
    sample_rate: int = 24000


class TTSProvider(ABC):
    """语音合成 Provider 抽象接口"""

    @abstractmethod
    async def synthesize(self, request: TTSRequest) -> TTSResult:
        """根据文本合成语音并返回音频块"""
        ...

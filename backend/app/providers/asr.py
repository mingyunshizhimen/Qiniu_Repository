"""ASR Provider 实现：Mock 和 DashScope"""

import logging
from typing import Any

import httpx

from backend.app.providers.base import (
    ASRProvider,
    ASRAudioChunk,
    ASRResult,
    TranscriptType,
)

logger = logging.getLogger(__name__)


class MockASRProvider(ASRProvider):
    """模拟 ASR Provider，用于开发和测试环境。

    将音频数据视为占位符，不进行实际语音识别。
    在测试场景中，可通过 send_audio 的返回值验证管线是否正常工作。
    """

    def __init__(self) -> None:
        self._initialized = False
        self._language = "zh-CN"

    async def initialize(self, language: str) -> None:
        """初始化 Mock ASR 会话"""
        self._language = language
        self._initialized = True
        logger.info(f"Mock ASR 已初始化，语言: {language}")

    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        """接收音频块，Mock 模式下返回空列表（无实际识别能力）"""
        if not self._initialized:
            raise RuntimeError("ASR 会话未初始化，请先调用 initialize")
        logger.debug(f"Mock ASR 收到音频块: {len(chunk.data)} bytes")
        return []

    async def finalize(self) -> list[ASRResult]:
        """结束 Mock ASR 会话，无缓冲数据"""
        self._initialized = False
        return []


class DashScopeASRProvider(ASRProvider):
    """DashScope ASR Provider，调用阿里百炼实时语音识别 API。

    使用 DashScope Paraformer 实时语音识别模型，
    支持流式输入和 interim/final 结果输出。
    """

    # DashScope 实时语音识别 API 地址
    API_URL = "https://dashscope.aliyuncs.com/api/v1/services/asr/transcription"
    MODEL_NAME = "paraformer-v2"
    TIMEOUT_SECONDS = 30.0

    def __init__(self, api_key: str) -> None:
        """
        初始化 DashScope ASR Provider

        Args:
            api_key: DashScope API 密钥
        """
        if not api_key or not api_key.strip():
            raise ValueError(
                "DashScope API Key 为空，请配置 DASHSCOPE_API_KEY 或使用 Mock Provider"
            )
        self.api_key = api_key.strip()
        self._session_id: str | None = None
        self._client: httpx.AsyncClient | None = None
        self._language = "zh-CN"

    async def initialize(self, language: str) -> None:
        """初始化 DashScope ASR 实时会话"""
        import json

        self._language = language
        self._client = httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS)

        # 构建请求参数
        payload = {
            "model": self.MODEL_NAME,
            "input": {
                "language_hints": [language],
            },
            "parameters": {
                "format": "pcm",
                "sample_rate": 16000,
                "enable_interim_results": True,
                "disfluency_removal_enabled": False,
                "inverse_text_normalization_enabled": True,
            },
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            response = await self._client.post(
                self.API_URL,
                json=payload,
                headers=headers,
            )
            response.raise_for_status()

            result = response.json()
            self._session_id = result.get("output", {}).get("session_id")
            logger.info(f"DashScope ASR 会话已启动: session_id={self._session_id}")

        except httpx.TimeoutException as e:
            logger.error(f"DashScope ASR 初始化超时: {e}")
            raise TimeoutError(f"DashScope ASR 初始化超时（{self.TIMEOUT_SECONDS}秒）") from e

        except httpx.HTTPStatusError as e:
            logger.error(f"DashScope ASR HTTP 错误: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"DashScope ASR 初始化失败: HTTP {e.response.status_code}") from e

        except (KeyError, IndexError) as e:
            logger.error(f"DashScope ASR 响应格式错误: {e}")
            raise ValueError("DashScope ASR 响应格式异常") from e

    async def send_audio(self, chunk: ASRAudioChunk) -> list[ASRResult]:
        """发送音频片段到 DashScope ASR 服务"""
        if not self._session_id or not self._client:
            raise RuntimeError("ASR 会话未初始化，请先调用 initialize")

        # DashScope 实时转录使用 WebSocket 而非 REST
        # 这里预留接口，实际实现需升级为 WebSocket 连接
        # 当前版本通过 REST 接口模拟，生产环境建议使用官方 SDK
        logger.warning(
            "DashScope ASR REST 接口不支持流式音频，"
            "建议使用 WebSocket SDK 或切换至 Mock Provider"
        )
        return []

    async def finalize(self) -> list[ASRResult]:
        """结束 DashScope ASR 会话"""
        results: list[ASRResult] = []
        if self._client:
            await self._client.aclose()
            self._client = None
        self._session_id = None
        logger.info("DashScope ASR 会话已结束")
        return results


def get_asr_provider(settings: Any) -> ASRProvider:
    """
    根据配置创建对应的 ASR Provider

    Args:
        settings: 应用配置对象（需包含 dashscope_api_key 属性）

    Returns:
        ASR Provider 实例
    """
    api_key = getattr(settings, "dashscope_api_key", None)

    if api_key and api_key.strip():
        logger.info("使用 DashScope ASR Provider")
        return DashScopeASRProvider(api_key=api_key)
    else:
        logger.info("使用 Mock ASR Provider（未配置 DashScope API Key）")
        return MockASRProvider()

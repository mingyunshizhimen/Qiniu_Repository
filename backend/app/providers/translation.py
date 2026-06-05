"""翻译 Provider 实现：Mock 和 DashScope"""

import logging
from typing import Any

import httpx

from backend.app.providers.base import (
    TranslationProvider,
    TranslationRequest,
    TranslationResult,
)

logger = logging.getLogger(__name__)


class MockTranslationProvider(TranslationProvider):
    """模拟翻译 Provider，用于开发和测试环境"""

    async def translate(self, request: TranslationRequest) -> TranslationResult:
        """执行模拟翻译"""
        # 对中文文本返回带前缀的模拟英文翻译
        translated_text = f"[MOCK] translated: {request.text}"
        logger.debug(f"Mock 翻译: {request.text} -> {translated_text}")

        return TranslationResult(
            translated_text=translated_text,
            source_text=request.text,
            provider="mock",
        )


class DashScopeTranslationProvider(TranslationProvider):
    """DashScope 翻译 Provider，调用阿里百炼 API"""

    # DashScope API 配置
    API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    MODEL_NAME = "qwen-plus"  # 使用 qwen-plus 模型
    TIMEOUT_SECONDS = 30.0  # 请求超时时间（秒）

    def __init__(self, api_key: str) -> None:
        """
        初始化 DashScope 翻译 Provider

        Args:
            api_key: DashScope API 密钥
        """
        if not api_key or not api_key.strip():
            raise ValueError(
                "DashScope API Key 为空，请配置 DASHSCOPE_API_KEY 或使用 Mock Provider"
            )
        self.api_key = api_key.strip()

    async def translate(self, request: TranslationRequest) -> TranslationResult:
        """调用 DashScope API 执行专业术语翻译"""
        # 构建系统提示词，指示模型进行专业术语翻译
        system_prompt = (
            "你是一个专业的技术文档翻译专家。请将用户提供的文本从 "
            f"{request.source_language} 翻译为 {request.target_language}。\n"
            "要求：\n"
            "1. 保持原文的专业性和准确性\n"
            "2. 技术术语使用标准英文译名\n"
            "3. 只输出翻译结果，不要添加任何解释或额外内容\n"
            "4. 如果有上下文参考译文，请保持术语翻译的一致性"
        )

        # 构建用户消息
        user_message = request.text

        # 如果有上下文，添加到消息中以提高一致性
        if request.context:
            context_text = "\n".join(
                [f"- {ctx}" for ctx in request.context[-5:]]  # 最近5条上下文
            )
            user_message = (
                f"参考译文（保持术语一致）：\n{context_text}\n\n"
                f"需要翻译的文本：\n{request.text}"
            )

        # 构建请求体
        payload: dict[str, Any] = {
            "model": self.MODEL_NAME,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": 0.3,  # 较低温度以保证翻译稳定性
            "max_tokens": 2000,
        }

        # 设置请求头
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            # 使用 httpx 异步客户端发送请求
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                response = await client.post(
                    self.API_URL,
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()  # 检查 HTTP 错误

                # 解析响应
                result = response.json()
                translated_text = result["choices"][0]["message"]["content"].strip()

                logger.info(f"DashScope 翻译成功: {request.text[:50]}...")

                return TranslationResult(
                    translated_text=translated_text,
                    source_text=request.text,
                    provider="dashscope",
                )

        except httpx.TimeoutException as e:
            logger.error(f"DashScope API 请求超时: {e}")
            raise TimeoutError(f"DashScope API 请求超时（{self.TIMEOUT_SECONDS}秒）") from e

        except httpx.HTTPStatusError as e:
            logger.error(f"DashScope API HTTP 错误: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(
                f"DashScope API 请求失败: HTTP {e.response.status_code}"
            ) from e

        except httpx.RequestError as e:
            logger.error(f"DashScope API 网络错误: {e}")
            raise ConnectionError(f"DashScope API 网络连接失败: {e}") from e

        except (KeyError, IndexError) as e:
            logger.error(f"DashScope API 响应格式错误: {e}")
            raise ValueError("DashScope API 响应格式异常") from e


def get_translation_provider(settings: Any) -> TranslationProvider:
    """
    根据配置创建对应的翻译 Provider

    Args:
        settings: 应用配置对象（需包含 dashscope_api_key 属性）

    Returns:
        翻译 Provider 实例
    """
    # 检查是否有有效的 API Key
    api_key = getattr(settings, "dashscope_api_key", None)

    if api_key and api_key.strip():
        logger.info("使用 DashScope 翻译 Provider")
        return DashScopeTranslationProvider(api_key=api_key)
    else:
        logger.info("使用 Mock 翻译 Provider（未配置 DashScope API Key）")
        return MockTranslationProvider()

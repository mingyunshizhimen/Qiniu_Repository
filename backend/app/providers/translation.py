"""Translation provider implementations for mock and DashScope backends."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from backend.app.providers.base import (
    GlossaryConstraint,
    TranslationProvider,
    TranslationRequest,
    TranslationResult,
)

logger = logging.getLogger(__name__)


class MockTranslationProvider(TranslationProvider):
    """Mock translation provider used during local development and tests."""

    async def translate(self, request: TranslationRequest) -> TranslationResult:
        translated_text = f"[MOCK] translated: {request.text}"
        logger.debug("Mock translation: %s -> %s", request.text, translated_text)
        return TranslationResult(
            translated_text=translated_text,
            source_text=request.text,
            provider="mock",
        )


class DashScopeTranslationProvider(TranslationProvider):
    """DashScope translation provider backed by Qwen chat completions."""

    API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    MODEL_NAME = "qwen-plus"
    TIMEOUT_SECONDS = 30.0

    def __init__(self, api_key: str) -> None:
        if not api_key or not api_key.strip():
            raise ValueError(
                "DashScope API key is empty. Configure DASHSCOPE_API_KEY or use the mock provider."
            )
        self.api_key = api_key.strip()

    async def translate(self, request: TranslationRequest) -> TranslationResult:
        payload: dict[str, Any] = {
            "model": self.MODEL_NAME,
            "messages": [
                {"role": "system", "content": self._build_system_prompt(request)},
                {"role": "user", "content": self._build_user_message(request)},
            ],
            "temperature": 0.3,
            "max_tokens": 2000,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.TIMEOUT_SECONDS) as client:
                response = await client.post(
                    self.API_URL,
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                result = response.json()
                translated_text = result["choices"][0]["message"]["content"].strip()

                logger.info("DashScope translation succeeded: %s...", request.text[:50])
                return TranslationResult(
                    translated_text=translated_text,
                    source_text=request.text,
                    provider="dashscope",
                )
        except httpx.TimeoutException as exc:
            logger.error("DashScope translation timed out: %s", exc)
            raise TimeoutError(
                f"DashScope translation timed out after {self.TIMEOUT_SECONDS} seconds"
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.error(
                "DashScope translation HTTP error: %s - %s",
                exc.response.status_code,
                exc.response.text,
            )
            raise RuntimeError(
                f"DashScope translation request failed: HTTP {exc.response.status_code}"
            ) from exc
        except httpx.RequestError as exc:
            logger.error("DashScope translation network error: %s", exc)
            raise ConnectionError(f"DashScope translation network error: {exc}") from exc
        except (KeyError, IndexError) as exc:
            logger.error("DashScope translation response parse error: %s", exc)
            raise ValueError("DashScope translation response format was invalid") from exc

    @staticmethod
    def _build_system_prompt(request: TranslationRequest) -> str:
        prompt = (
            "你是一个专业的技术翻译助手。"
            f"请将用户提供的文本从 {request.source_language} 翻译为 {request.target_language}。\n"
            "要求：\n"
            "1. 保持技术语义准确。\n"
            "2. 保持术语和上下文翻译一致。\n"
            "3. 只输出翻译结果，不要输出解释。\n"
        )
        if request.glossary_terms:
            prompt += "4. 如果提供了术语约束，必须优先使用给定的标准译名。\n"
        return prompt

    @staticmethod
    def _build_user_message(request: TranslationRequest) -> str:
        message_parts: list[str] = []

        if request.context:
            context_lines = "\n".join(f"- {ctx}" for ctx in request.context[-5:])
            message_parts.append(f"参考上下文（保持术语一致）：\n{context_lines}")

        if request.glossary_terms:
            glossary_lines = "\n".join(
                DashScopeTranslationProvider._format_constraint(constraint)
                for constraint in request.glossary_terms
            )
            message_parts.append(
                "术语约束（必须优先使用标准译名）：\n"
                f"{glossary_lines}"
            )

        if not message_parts:
            return request.text

        message_parts.append(f"需要翻译的文本：\n{request.text}")
        return "\n\n".join(message_parts)

    @staticmethod
    def _format_constraint(constraint: GlossaryConstraint) -> str:
        return f"- {constraint.source_term} => {constraint.target_term}"


def get_translation_provider(settings: Any) -> TranslationProvider:
    api_key = getattr(settings, "dashscope_api_key", None)
    if api_key and api_key.strip():
        logger.info("Using DashScope translation provider")
        return DashScopeTranslationProvider(api_key=api_key)

    logger.info("Using mock translation provider (no DashScope API key configured)")
    return MockTranslationProvider()

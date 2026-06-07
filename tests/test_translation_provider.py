import asyncio
import json

from backend.app.providers.base import GlossaryConstraint, TranslationRequest
from backend.app.providers.translation import DashScopeTranslationProvider


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload
        self.status_code = 200
        self.text = json.dumps(payload)

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class FakeAsyncClient:
    def __init__(self, collector: list[dict]) -> None:
        self.collector = collector

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, json: dict, headers: dict) -> FakeResponse:
        self.collector.append(
            {
                "url": url,
                "json": json,
                "headers": headers,
            }
        )
        return FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": "Qiniu Cloud Object Storage"
                        }
                    }
                ]
            }
        )


def test_dashscope_translation_includes_glossary_constraints(monkeypatch) -> None:
    captured_requests: list[dict] = []

    def fake_client_factory(*args, **kwargs) -> FakeAsyncClient:
        return FakeAsyncClient(captured_requests)

    monkeypatch.setattr(
        "backend.app.providers.translation.httpx.AsyncClient",
        fake_client_factory,
    )

    provider = DashScopeTranslationProvider(api_key="test-key")
    asyncio.run(
        provider.translate(
            TranslationRequest(
                text="七牛云对象存储服务",
                source_language="zh-CN",
                target_language="en-US",
                glossary_terms=[
                    GlossaryConstraint(
                        source_term="七牛云",
                        target_term="Qiniu Cloud",
                        start_index=0,
                    ),
                    GlossaryConstraint(
                        source_term="对象存储",
                        target_term="Object Storage",
                        start_index=3,
                    ),
                ],
            )
        )
    )

    payload = captured_requests[0]["json"]
    messages = payload["messages"]

    assert "术语约束" in messages[1]["content"]
    assert "七牛云 => Qiniu Cloud" in messages[1]["content"]
    assert "对象存储 => Object Storage" in messages[1]["content"]


def test_dashscope_translation_without_glossary_keeps_plain_user_message(
    monkeypatch,
) -> None:
    captured_requests: list[dict] = []

    def fake_client_factory(*args, **kwargs) -> FakeAsyncClient:
        return FakeAsyncClient(captured_requests)

    monkeypatch.setattr(
        "backend.app.providers.translation.httpx.AsyncClient",
        fake_client_factory,
    )

    provider = DashScopeTranslationProvider(api_key="test-key")
    asyncio.run(
        provider.translate(
            TranslationRequest(
                text="普通测试文本",
                source_language="zh-CN",
                target_language="en-US",
            )
        )
    )

    payload = captured_requests[0]["json"]
    messages = payload["messages"]

    assert messages[1]["content"] == "普通测试文本"

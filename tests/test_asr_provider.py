"""ASR Provider 单元测试"""

import pytest

from backend.app.providers.asr import (
    DashScopeASRProvider,
    MockASRProvider,
    get_asr_provider,
)
from backend.app.providers.base import (
    ASRAudioChunk,
    ASRResult,
    TranscriptType,
)


class TestMockASRProvider:
    """MockASRProvider 测试套件"""

    @pytest.fixture
    def provider(self) -> MockASRProvider:
        return MockASRProvider()

    @pytest.mark.asyncio
    async def test_initialize_sets_language(self, provider: MockASRProvider) -> None:
        """初始化后应记录语言设置"""
        await provider.initialize("zh-CN")
        assert provider._language == "zh-CN"
        assert provider._initialized is True

    @pytest.mark.asyncio
    async def test_send_audio_before_init_raises(self, provider: MockASRProvider) -> None:
        """未初始化时发送音频应报错"""
        chunk = ASRAudioChunk(data=b"\x00" * 100)
        with pytest.raises(RuntimeError, match="未初始化"):
            await provider.send_audio(chunk)

    @pytest.mark.asyncio
    async def test_send_audio_returns_empty_list(self, provider: MockASRProvider) -> None:
        """发送音频块应返回空列表（Mock 无识别能力）"""
        await provider.initialize("zh-CN")
        chunk = ASRAudioChunk(data=b"\x00" * 320)  # 20ms @ 16kHz 16bit
        results = await provider.send_audio(chunk)
        assert results == []

    @pytest.mark.asyncio
    async def test_finalize_resets_state(self, provider: MockASRProvider) -> None:
        """结束会话应重置初始化状态"""
        await provider.initialize("zh-CN")
        results = await provider.finalize()
        assert results == []
        assert provider._initialized is False


class TestDashScopeASRProvider:
    """DashScopeASRProvider 测试套件"""

    def test_init_with_empty_key_raises(self) -> None:
        """空 API Key 应抛出 ValueError"""
        with pytest.raises(ValueError, match="API Key"):
            DashScopeASRProvider(api_key="")

        with pytest.raises(ValueError, match="API Key"):
            DashScopeASRProvider(api_key="   ")

    def test_init_with_valid_key(self) -> None:
        """有效 API Key 应正常创建实例"""
        provider = DashScopeASRProvider(api_key="test-key-12345")
        assert provider.api_key == "test-key-12345"

    @pytest.mark.asyncio
    async def test_send_audio_before_init_raises(self) -> None:
        """未初始化时发送音频应报错"""
        provider = DashScopeASRProvider(api_key="test-key")
        chunk = ASRAudioChunk(data=b"\x00" * 100)
        with pytest.raises(RuntimeError, match="未初始化"):
            await provider.send_audio(chunk)

    @pytest.mark.asyncio
    async def test_finalize_before_init_does_not_crash(self) -> None:
        """未初始化时 finalize 不应崩溃"""
        provider = DashScopeASRProvider(api_key="test-key")
        results = await provider.finalize()
        assert results == []


class TestGetASRProvider:
    """工厂函数测试套件"""

    def test_no_api_key_returns_mock(self) -> None:
        """无 API Key 时应返回 Mock Provider"""
        class FakeSettings:
            dashscope_api_key = None

        provider = get_asr_provider(FakeSettings())
        assert isinstance(provider, MockASRProvider)

    def test_empty_api_key_returns_mock(self) -> None:
        """空字符串 API Key 应返回 Mock Provider"""
        class FakeSettings:
            dashscope_api_key = "   "

        provider = get_asr_provider(FakeSettings())
        assert isinstance(provider, MockASRProvider)

    def test_valid_api_key_returns_dashscope(self) -> None:
        """有效 API Key 应返回 DashScope Provider"""
        class FakeSettings:
            dashscope_api_key = "sk-real-key-abc"

        provider = get_asr_provider(FakeSettings())
        assert isinstance(provider, DashScopeASRProvider)

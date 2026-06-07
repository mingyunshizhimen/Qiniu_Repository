import asyncio
import base64

from backend.app.providers.base import GlossaryConstraint
from backend.app.realtime.models import ClientCommand
from backend.app.realtime.pipeline import RealtimeASRPipeline
from backend.app.realtime.session import RealtimeSession
from backend.app.services.glossary import GlossaryService
from tests.test_realtime_protocol import (
    FakeASRProvider,
    FakeTTSProvider,
    FakeTranslationProvider,
    command,
)


def test_pipeline_passes_glossary_constraints_to_translation_request() -> None:
    glossary_service = GlossaryService()
    glossary_service.add_term("Complete semantic unit", "完整语义单元")
    glossary_service.add_term("semantic unit", "语义单元")

    async def run_pipeline() -> tuple[list, list]:
        asr_provider = FakeASRProvider(final_text="Complete semantic unit.")
        translation_provider = FakeTranslationProvider()
        pipeline = RealtimeASRPipeline(
            RealtimeSession("audio-demo"),
            asr_provider,
            translation_provider,
            FakeTTSProvider(),
            glossary_service=glossary_service,
        )

        await pipeline.handle(
            ClientCommand.model_validate(
                command(
                    "session.start",
                    1,
                    {
                        "source_language": "en-US",
                        "target_language": "zh-CN",
                    },
                )
            )
        )
        await pipeline.handle(
            ClientCommand.model_validate(
                command(
                    "audio.append",
                    2,
                    {
                        "audio": base64.b64encode(b"\x01\x02").decode("ascii"),
                        "format": "pcm",
                        "sample_rate": 16000,
                    },
                )
            )
        )
        events = await pipeline.handle(
            ClientCommand.model_validate(command("session.stop", 3))
        )
        await pipeline.close()
        return events, translation_provider.requests

    events, requests = asyncio.run(run_pipeline())

    translation_event = next(
        event for event in events if event.type == "translation.final"
    )
    assert translation_event.payload["term_hits"] == [
        {
            "source_term": "Complete semantic unit",
            "target_term": "完整语义单元",
            "start_index": 0,
        },
        {
            "source_term": "semantic unit",
            "target_term": "语义单元",
            "start_index": 9,
        },
    ]
    assert requests[0].glossary_terms == [
        GlossaryConstraint(
            source_term="Complete semantic unit",
            target_term="完整语义单元",
            start_index=0,
        ),
        GlossaryConstraint(
            source_term="semantic unit",
            target_term="语义单元",
            start_index=9,
        ),
    ]


def test_pipeline_keeps_translation_request_clean_without_glossary_matches() -> None:
    glossary_service = GlossaryService()

    async def run_pipeline() -> tuple[list, list]:
        asr_provider = FakeASRProvider(final_text="No glossary here.")
        translation_provider = FakeTranslationProvider()
        pipeline = RealtimeASRPipeline(
            RealtimeSession("audio-demo"),
            asr_provider,
            translation_provider,
            FakeTTSProvider(),
            glossary_service=glossary_service,
        )

        await pipeline.handle(
            ClientCommand.model_validate(
                command(
                    "session.start",
                    1,
                    {
                        "source_language": "en-US",
                        "target_language": "zh-CN",
                    },
                )
            )
        )
        await pipeline.handle(
            ClientCommand.model_validate(
                command(
                    "audio.append",
                    2,
                    {
                        "audio": base64.b64encode(b"\x01\x02").decode("ascii"),
                        "format": "pcm",
                        "sample_rate": 16000,
                    },
                )
            )
        )
        events = await pipeline.handle(
            ClientCommand.model_validate(command("session.stop", 3))
        )
        await pipeline.close()
        return events, translation_provider.requests

    events, requests = asyncio.run(run_pipeline())

    translation_event = next(
        event for event in events if event.type == "translation.final"
    )
    assert translation_event.payload["term_hits"] == []
    assert requests[0].glossary_terms == []

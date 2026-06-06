from backend.app.realtime.semantic import SemanticSegmenter


def test_semantic_segmenter_holds_plain_fragments_until_boundary() -> None:
    segmenter = SemanticSegmenter()

    assert segmenter.push("we should talk about") == []
    assert segmenter.push("response speed and translation quality") == []
    assert segmenter.flush() == ["we should talk about response speed and translation quality"]


def test_semantic_segmenter_emits_after_sentence_boundary() -> None:
    segmenter = SemanticSegmenter()

    assert segmenter.push("This is the first complete idea.") == [
        "This is the first complete idea."
    ]


def test_semantic_segmenter_merges_short_follow_up_clause() -> None:
    segmenter = SemanticSegmenter()

    assert segmenter.push("We should improve latency") == []
    assert segmenter.push("and quality,") == []
    assert segmenter.push("not just accuracy.") == [
        "We should improve latency and quality, not just accuracy."
    ]

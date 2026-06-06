# 07 Semantic Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantic segmentation layer between final ASR text and translation so the realtime interpreter emits complete semantic units instead of translating every fragment immediately.

**Architecture:** Realtime ASR continues to produce `transcript.partial` and `transcript.final` events. A new semantic segmentation component buffers confirmed source text, uses a small rule-based candidate generator plus a lightweight confirmation decision, and emits `semantic_unit.final` only when a complete meaning boundary is reached. Translation consumes semantic units rather than raw transcript fragments, which preserves the current 06 realtime translation behavior while making the output less choppy and easier to speak aloud.

**Tech Stack:** Python 3.13, FastAPI, Pydantic, pytest, React, TypeScript, Vitest.

---

### Task 1: Add backend tests that define semantic unit behavior

**Files:**
- Create: `tests/test_semantic_segmentation.py`

- [ ] **Step 1: Write the failing test**

```python
from backend.app.realtime.semantic import SemanticSegmenter


def test_semantic_segmenter_waits_for_a_complete_clause():
    segmenter = SemanticSegmenter()

    assert segmenter.push("我们先看一下") == []
    assert segmenter.push("实时字幕的边界") == []

    result = segmenter.push("，然后再决定是否翻译。")

    assert result == ["我们先看一下实时字幕的边界，然后再决定是否翻译。"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -q tests/test_semantic_segmentation.py -v`
Expected: FAIL with `ModuleNotFoundError` or missing `SemanticSegmenter`.

- [ ] **Step 3: Write minimal implementation**

```python
class SemanticSegmenter:
    def __init__(self) -> None:
        self._buffer: list[str] = []

    def push(self, text: str) -> list[str]:
        self._buffer.append(text)
        if text.endswith(("。", "！", "？")):
            joined = "".join(self._buffer).strip()
            self._buffer.clear()
            return [joined]
        return []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -q tests/test_semantic_segmentation.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_semantic_segmentation.py
git commit -m "test: define semantic segmentation boundary behavior"
```

### Task 2: Implement the semantic segmentation component in the backend

**Files:**
- Create: `backend/app/realtime/semantic.py`
- Modify: `backend/app/realtime/pipeline.py`
- Modify: `backend/app/realtime/__init__.py`

- [ ] **Step 1: Write the failing test**

Extend `tests/test_semantic_segmentation.py` with a case that proves buffered clauses are emitted only after a semantic boundary is confirmed.

```python
def test_semantic_segmenter_keeps_buffer_until_boundary():
    segmenter = SemanticSegmenter()

    assert segmenter.push("今天我们先讨论") == []
    assert segmenter.push("MVP 的演示效果") == []
    assert segmenter.flush() == ["今天我们先讨论MVP 的演示效果"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -q tests/test_semantic_segmentation.py -v`
Expected: FAIL because `flush()` is missing.

- [ ] **Step 3: Write minimal implementation**

```python
from dataclasses import dataclass, field


@dataclass
class SemanticSegmenter:
    _buffer: list[str] = field(default_factory=list)

    def push(self, text: str) -> list[str]:
        self._buffer.append(text.strip())
        if text.endswith(("。", "！", "？")):
            joined = "".join(self._buffer).strip()
            self._buffer.clear()
            return [joined]
        if len("".join(self._buffer)) >= 40:
            joined = "".join(self._buffer).strip()
            self._buffer.clear()
            return [joined]
        return []

    def flush(self) -> list[str]:
        if not self._buffer:
            return []
        joined = "".join(self._buffer).strip()
        self._buffer.clear()
        return [joined]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -q tests/test_semantic_segmentation.py -v`
Expected: PASS.

- [ ] **Step 5: Wire the segmenter into realtime pipeline**

Update `backend/app/realtime/pipeline.py` so `transcript.final` from ASR is first passed into `SemanticSegmenter`.
Only when the segmenter emits a semantic unit should the pipeline call the translation provider.

Example shape:

```python
semantic_units = self._segmenter.push(result.text)
for semantic_unit in semantic_units:
    translated = await self._translation_provider.translate(
        TranslationRequest(
            text=semantic_unit,
            source_language=self._source_language,
            target_language=self._target_language,
            context=self._confirmed_transcripts[-5:],
        )
    )
```

- [ ] **Step 6: Run backend tests**

Run: `python -m pytest -q tests/test_realtime_protocol.py tests/test_asr_pipeline.py tests/test_semantic_segmentation.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/realtime/pipeline.py backend/app/realtime/semantic.py backend/app/realtime/__init__.py tests/test_semantic_segmentation.py tests/test_realtime_protocol.py
git commit -m "feat: add semantic segmentation before translation"
```

### Task 3: Surface semantic unit output in the realtime protocol

**Files:**
- Modify: `backend/app/realtime/pipeline.py`
- Modify: `backend/app/realtime/models.py`
- Modify: `backend/app/api/realtime.py`
- Modify: `tests/test_realtime_protocol.py`

- [ ] **Step 1: Write the failing test**

Add a websocket test that verifies a confirmed semantic unit emits `semantic_unit.final` before translation:

```python
def test_semantic_unit_final_is_emitted_before_translation():
    # send enough confirmed ASR text to trigger the segmenter
    # expect websocket events in order:
    # 1) transcript.final
    # 2) semantic_unit.final
    # 3) translation.final
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -q tests/test_realtime_protocol.py -v`
Expected: FAIL because `semantic_unit.final` is not emitted yet.

- [ ] **Step 3: Add event schema support**

```python
class ServerEvent(BaseModel):
    version: Literal["1.0"] = "1.0"
    type: str
    session_id: str
    trace_id: str
    sequence: int = Field(ge=1)
    timestamp: datetime
    payload: dict[str, Any]
```

No schema change is required if `type` remains a string, but the test must assert the new event type is produced and ordered correctly.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -q tests/test_realtime_protocol.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/realtime/pipeline.py backend/app/realtime/semantic.py backend/app/api/realtime.py tests/test_realtime_protocol.py
git commit -m "feat: emit semantic units in realtime protocol"
```

### Task 4: Make the frontend render semantic units cleanly

**Files:**
- Modify: `frontend/src/realtime/client.ts`
- Modify: `frontend/src/realtime/useRealtimeASR.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/realtime/client.test.ts`

- [ ] **Step 1: Write the failing test**

Add a frontend test that verifies semantic units appear as discrete source segments when the backend emits `semantic_unit.final`.

```ts
expect(screen.getByText("这是一个完整的语义单元。")).toBeInTheDocument();
expect(screen.getByText("This is a complete semantic unit.")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because the client does not yet parse `semantic_unit.final`.

- [ ] **Step 3: Add minimal client handling**

```ts
if (event.type === "semantic_unit.final") {
  this.options.onSemanticUnit?.({
    text: String(event.payload.text ?? ""),
    status: "final",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/realtime/client.ts frontend/src/realtime/useRealtimeASR.ts frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/realtime/client.test.ts
git commit -m "feat: render semantic units in the workspace"
```

### Task 5: Define manual verification for real-device testing

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the manual test checklist**

Document the real-device test:

1. Start backend with `uvicorn backend.app.main:app --reload`.
2. Start frontend with `npm run dev`.
3. Open `/interpreter`.
4. Click `Start realtime ASR`.
5. Speak a sentence with at least one pause and one full stop.
6. Confirm the console or server logs show a semantic unit being finalized.
7. Confirm the websocket emits `semantic_unit.final`.
8. Confirm translation only happens after the semantic unit is finalized.

- [ ] **Step 2: Define success output**

Success means:

- One complete thought becomes one semantic unit.
- The translation appears only after that unit closes.
- The unit is not split into obviously tiny fragments.
- Server logs show the segmenter emitted, buffered, and flushed as expected.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add semantic segmentation verification steps"
```


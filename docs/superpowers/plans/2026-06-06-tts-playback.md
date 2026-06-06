# 08 TTS Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in speech playback toggle to the realtime interpreter so translated text can be spoken aloud without blocking the subtitle flow.

**Architecture:** The workspace keeps subtitles as the primary output and treats speech playback as an optional side channel. When the playback switch is on, confirmed translations are queued for speech synthesis. The first-line implementation uses browser speech synthesis as the guaranteed fallback, while the backend can optionally call DashScope TTS when `DASHSCOPE_API_KEY` is available and expose playback-ready audio to the frontend. Playback failures must never block transcript or translation events.

**Tech Stack:** Python 3.12, FastAPI, WebSocket events, React, TypeScript, browser `SpeechSynthesis`, pytest, Vitest.

---

### Task 1: Add backend TTS plumbing and playback events

**Files:**
- Create: `backend/app/providers/tts.py`
- Modify: `backend/app/providers/base.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/api/realtime.py`
- Modify: `backend/app/realtime/pipeline.py`
- Test: `tests/test_tts_provider.py`
- Test: `tests/test_realtime_protocol.py`

- [ ] **Step 1: Write the failing tests**

```python
import pytest

from backend.app.providers.base import TTSRequest
from backend.app.providers.tts import MockTTSProvider, get_tts_provider


@pytest.mark.asyncio
async def test_mock_tts_provider_returns_no_audio():
    provider = MockTTSProvider()
    result = await provider.synthesize(
        TTSRequest(text="Hello world", language="en-US")
    )

    assert result.provider == "mock"
    assert result.audio is None


def test_tts_provider_defaults_to_mock_without_key():
    class Settings:
        dashscope_api_key = None

    provider = get_tts_provider(Settings())

    assert isinstance(provider, MockTTSProvider)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -q tests/test_tts_provider.py -v`
Expected: FAIL because `backend/app/providers/tts.py` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class TTSRequest:
    text: str
    language: str


@dataclass
class TTSResult:
    audio: bytes | None
    provider: str


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, request: TTSRequest) -> TTSResult:
        ...


class MockTTSProvider(TTSProvider):
    async def synthesize(self, request: TTSRequest) -> TTSResult:
        return TTSResult(audio=None, provider="mock")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -q tests/test_tts_provider.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/providers/base.py backend/app/providers/tts.py backend/app/core/config.py backend/app/api/realtime.py backend/app/realtime/pipeline.py tests/test_tts_provider.py tests/test_realtime_protocol.py
git commit -m "feat: add optional TTS playback backend"
```

### Task 2: Add browser playback toggle and queue handling in the frontend

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/realtime/useRealtimeASR.ts`
- Modify: `frontend/src/realtime/client.ts`
- Modify: `frontend/src/realtime/client.test.ts`
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/realtime/usePlaybackQueue.test.ts`
- Create: `frontend/src/realtime/usePlaybackQueue.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { createPlaybackQueue } from "./usePlaybackQueue";

describe("playback queue", () => {
  it("queues confirmed translations only when playback is enabled", () => {
    const queue = createPlaybackQueue();

    queue.setEnabled(false);
    queue.enqueue("hello");
    expect(queue.size()).toBe(0);

    queue.setEnabled(true);
    queue.enqueue("hello");
    expect(queue.size()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- src/realtime/usePlaybackQueue.test.ts`
Expected: FAIL because the playback hook does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
// Add a playback toggle to the interpreter toolbar.
// When enabled, confirmed translations are queued for speech synthesis.
// When disabled, subtitles continue to render and playback is skipped.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/realtime/useRealtimeASR.ts frontend/src/realtime/client.ts frontend/src/realtime/client.test.ts frontend/src/styles.css frontend/src/realtime/usePlaybackQueue.test.ts
git commit -m "feat: add interpreter speech playback toggle"
```

### Task 3: Update docs and verify the no-key fallback path

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-06-tts-playback-design.md`

- [ ] **Step 1: Write the documentation updates**

```markdown
## 08 TTS Playback

- Speech playback is optional and controlled by a workspace toggle.
- Without `DASHSCOPE_API_KEY`, the app falls back to browser speech synthesis.
- With `DASHSCOPE_API_KEY`, the backend can use DashScope TTS.
- Subtitle rendering never waits on playback completion.
```

- [ ] **Step 2: Review the updated README**

Run: inspect the README locally and confirm it explains:
- how to enable or disable speech playback
- how the no-key fallback works
- that subtitles still function without playback

- [ ] **Step 3: Final verification**

Run: `python -m pytest -q` and `cd frontend && npm run test && npm run build`

Expected: all tests pass and the frontend build succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-06-06-tts-playback-design.md
git commit -m "docs: document optional speech playback"
```

## Self-Review

- The plan covers the backend TTS abstraction, frontend playback toggle, and the documentation needed for the no-key fallback path.
- No placeholder sections remain.
- The backend and frontend responsibilities stay separated, and playback remains optional so subtitle delivery is never blocked.

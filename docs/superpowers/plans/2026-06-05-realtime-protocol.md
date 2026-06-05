# Realtime Session Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned WebSocket protocol that manages one realtime session and emits partial/final mock transcript events from text fallback input.

**Architecture:** A FastAPI WebSocket endpoint delegates commands to an in-memory `RealtimeSession`. Pydantic models validate client messages and serialize server events. The session state machine owns legal transitions and event sequencing; ASR, translation, persistence, and multi-client broadcasting remain outside this PR.

**Tech Stack:** Python 3.12, FastAPI WebSocket, Pydantic 2, pytest, Starlette TestClient

---

### Task 1: Define the protocol contract

**Files:**
- Create: `backend/app/realtime/models.py`
- Test: `tests/test_realtime_protocol.py`

- [x] Write a WebSocket test that connects to `/api/v1/ws/sessions/demo-session`, sends a `session.start` command, and expects a versioned `session.state` event with state `active`.
- [x] Run `python -m pytest tests/test_realtime_protocol.py -v` and confirm the endpoint is missing.
- [x] Add Pydantic command validation and a shared server event envelope containing `version`, `type`, `session_id`, `trace_id`, `sequence`, `timestamp`, and `payload`.

### Task 2: Implement session state transitions

**Files:**
- Create: `backend/app/realtime/session.py`
- Modify: `tests/test_realtime_protocol.py`

- [x] Add failing tests for `session.pause`, `session.resume`, and `session.stop`.
- [x] Implement the `idle -> active -> paused -> active -> stopped` state machine.
- [x] Return structured `error` events for invalid transitions without closing the socket.

### Task 3: Emit mock transcript events

**Files:**
- Create: `backend/app/api/realtime.py`
- Modify: `backend/app/main.py`
- Modify: `tests/test_realtime_protocol.py`

- [x] Add a failing test proving `text.submit` emits `transcript.partial` followed by `transcript.final` while active.
- [x] Add a failing test proving text is rejected while paused or stopped.
- [x] Implement the WebSocket receive loop and deterministic text fallback adapter.
- [x] Ensure every outbound event has a monotonically increasing sequence and a unique trace ID per command.

### Task 4: Document and verify

**Files:**
- Modify: `README.md`

- [x] Document endpoint, commands, emitted events, and a browser-console example.
- [x] Run `python -m pytest -v`.
- [x] Run `python -m pip check` and `python -m compileall -q backend`.
- [x] Start Uvicorn and manually verify the health endpoint still returns HTTP 200.
- [x] Present the local implementation for user review without committing or pushing.

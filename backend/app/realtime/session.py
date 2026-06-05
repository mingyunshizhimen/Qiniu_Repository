from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from backend.app.realtime.models import ClientCommand, ServerEvent

SessionState = Literal["idle", "active", "paused", "stopped"]

TRANSITIONS: dict[tuple[SessionState, str], SessionState] = {
    ("idle", "session.start"): "active",
    ("active", "session.pause"): "paused",
    ("paused", "session.resume"): "active",
    ("active", "session.stop"): "stopped",
    ("paused", "session.stop"): "stopped",
}


class RealtimeSession:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.state: SessionState = "idle"
        self._last_inbound_sequence = 0
        self._outbound_sequence = 0

    def handle(self, command: ClientCommand) -> list[ServerEvent]:
        trace_id, error = self.accept_command(command)
        if error is not None:
            return [error]

        if command.type == "text.submit":
            return self._handle_text_submit(command, trace_id)

        next_state = TRANSITIONS.get((self.state, command.type))
        if next_state is None:
            return [self._invalid_transition(command.type, trace_id)]

        self.state = next_state
        return [
            self._event(
                event_type="session.state",
                trace_id=trace_id,
                payload={"state": self.state},
            )
        ]

    def accept_audio_command(
        self,
        command: ClientCommand,
    ) -> tuple[str, ServerEvent | None]:
        trace_id, error = self.accept_command(command)
        if error is not None:
            return trace_id, error
        if self.state != "active":
            return trace_id, self._invalid_transition(command.type, trace_id)
        return trace_id, None

    def accept_command(
        self,
        command: ClientCommand,
    ) -> tuple[str, ServerEvent | None]:
        trace_id = str(uuid4())
        if command.sequence <= self._last_inbound_sequence:
            return trace_id, self._event(
                event_type="error",
                trace_id=trace_id,
                payload={
                    "code": "invalid_sequence",
                    "received": command.sequence,
                    "last_received": self._last_inbound_sequence,
                    "message": "Command sequence must increase monotonically.",
                },
            )

        self._last_inbound_sequence = command.sequence
        return trace_id, None

    def event(
        self,
        event_type: str,
        trace_id: str,
        payload: dict[str, Any],
    ) -> ServerEvent:
        return self._event(event_type, trace_id, payload)

    def protocol_error(self, message: str) -> ServerEvent:
        return self._event(
            event_type="error",
            trace_id=str(uuid4()),
            payload={
                "code": "invalid_message",
                "message": message,
            },
        )

    def _handle_text_submit(
        self,
        command: ClientCommand,
        trace_id: str,
    ) -> list[ServerEvent]:
        if self.state != "active":
            return [self._invalid_transition(command.type, trace_id)]

        text = str(command.payload.get("text", "")).strip()
        if not text:
            return [
                self._event(
                    event_type="error",
                    trace_id=trace_id,
                    payload={
                        "code": "invalid_payload",
                        "command": command.type,
                        "message": "text.submit requires non-empty text.",
                    },
                )
            ]

        partial_length = max(1, len(text) // 2)
        common_payload = {"source": "text_fallback"}
        return [
            self._event(
                event_type="transcript.partial",
                trace_id=trace_id,
                payload={**common_payload, "text": text[:partial_length]},
            ),
            self._event(
                event_type="transcript.final",
                trace_id=trace_id,
                payload={**common_payload, "text": text},
            ),
        ]

    def _invalid_transition(
        self,
        command_type: str,
        trace_id: str,
    ) -> ServerEvent:
        return self._event(
            event_type="error",
            trace_id=trace_id,
            payload={
                "code": "invalid_transition",
                "command": command_type,
                "current_state": self.state,
                "message": (
                    f"Cannot handle {command_type} while session "
                    f"is {self.state}."
                ),
            },
        )

    def _event(
        self,
        event_type: str,
        trace_id: str,
        payload: dict[str, Any],
    ) -> ServerEvent:
        self._outbound_sequence += 1
        return ServerEvent(
            type=event_type,
            session_id=self.session_id,
            trace_id=trace_id,
            sequence=self._outbound_sequence,
            timestamp=datetime.now(UTC),
            payload=payload,
        )

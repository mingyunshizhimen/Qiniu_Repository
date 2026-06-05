from fastapi.testclient import TestClient

from backend.app.main import app


def command(command_type: str, sequence: int, payload: dict | None = None) -> dict:
    return {
        "version": "1.0",
        "type": command_type,
        "sequence": sequence,
        "payload": payload or {},
    }


def test_start_session_emits_active_state_event() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(
                command(
                    "session.start",
                    1,
                    {
                        "source_language": "zh-CN",
                        "target_language": "en-US",
                    },
                )
            )

            event = websocket.receive_json()

    assert event["version"] == "1.0"
    assert event["type"] == "session.state"
    assert event["session_id"] == "demo-session"
    assert event["sequence"] == 1
    assert event["payload"] == {"state": "active"}
    assert event["trace_id"]
    assert event["timestamp"]


def test_session_supports_pause_resume_and_stop() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(command("session.start", 1))
            assert websocket.receive_json()["payload"]["state"] == "active"

            websocket.send_json(command("session.pause", 2))
            paused = websocket.receive_json()

            websocket.send_json(command("session.resume", 3))
            resumed = websocket.receive_json()

            websocket.send_json(command("session.stop", 4))
            stopped = websocket.receive_json()

    assert paused["type"] == "session.state"
    assert paused["sequence"] == 2
    assert paused["payload"] == {"state": "paused"}
    assert resumed["sequence"] == 3
    assert resumed["payload"] == {"state": "active"}
    assert stopped["sequence"] == 4
    assert stopped["payload"] == {"state": "stopped"}


def test_invalid_transition_returns_error_without_closing_socket() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(command("session.pause", 1))
            error = websocket.receive_json()

            websocket.send_json(command("session.start", 2))
            active = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"] == {
        "code": "invalid_transition",
        "command": "session.pause",
        "current_state": "idle",
        "message": "Cannot handle session.pause while session is idle.",
    }
    assert active["type"] == "session.state"
    assert active["payload"] == {"state": "active"}


def test_text_submit_emits_partial_then_final_transcript() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(command("session.start", 1))
            websocket.receive_json()

            websocket.send_json(
                command(
                    "text.submit",
                    2,
                    {"text": "我们使用七牛云对象存储。"},
                )
            )
            partial = websocket.receive_json()
            final = websocket.receive_json()

    assert partial["type"] == "transcript.partial"
    assert partial["sequence"] == 2
    assert partial["payload"]["text"]
    assert partial["payload"]["text"] != final["payload"]["text"]
    assert partial["payload"]["source"] == "text_fallback"
    assert final["type"] == "transcript.final"
    assert final["sequence"] == 3
    assert final["payload"] == {
        "text": "我们使用七牛云对象存储。",
        "source": "text_fallback",
    }
    assert partial["trace_id"] == final["trace_id"]


def test_text_submit_is_rejected_while_paused() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(command("session.start", 1))
            websocket.receive_json()
            websocket.send_json(command("session.pause", 2))
            websocket.receive_json()

            websocket.send_json(
                command("text.submit", 3, {"text": "不会被处理"})
            )
            error = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"]["code"] == "invalid_transition"
    assert error["payload"]["command"] == "text.submit"
    assert error["payload"]["current_state"] == "paused"


def test_empty_text_returns_error_and_connection_stays_open() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(command("session.start", 1))
            websocket.receive_json()

            websocket.send_json(command("text.submit", 2, {"text": "  "}))
            error = websocket.receive_json()

            websocket.send_json(
                command("text.submit", 3, {"text": "连接仍然可用"})
            )
            partial = websocket.receive_json()
            final = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"] == {
        "code": "invalid_payload",
        "command": "text.submit",
        "message": "text.submit requires non-empty text.",
    }
    assert partial["type"] == "transcript.partial"
    assert final["type"] == "transcript.final"


def test_invalid_message_returns_error_and_connection_stays_open() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(
                {
                    "version": "2.0",
                    "type": "session.start",
                    "sequence": 1,
                    "payload": {},
                }
            )
            error = websocket.receive_json()

            websocket.send_json(command("session.start", 2))
            active = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"]["code"] == "invalid_message"
    assert error["payload"]["message"] == "Message does not match protocol v1.0."
    assert active["type"] == "session.state"
    assert active["payload"] == {"state": "active"}


def test_duplicate_command_sequence_is_rejected_without_state_change() -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/api/v1/ws/sessions/demo-session"
        ) as websocket:
            websocket.send_json(command("session.start", 1))
            websocket.receive_json()

            websocket.send_json(command("session.pause", 1))
            error = websocket.receive_json()

            websocket.send_json(command("session.pause", 2))
            paused = websocket.receive_json()

    assert error["type"] == "error"
    assert error["payload"] == {
        "code": "invalid_sequence",
        "received": 1,
        "last_received": 1,
        "message": "Command sequence must increase monotonically.",
    }
    assert paused["type"] == "session.state"
    assert paused["payload"] == {"state": "paused"}

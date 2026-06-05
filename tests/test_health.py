from fastapi.testclient import TestClient

from backend.app.core.config import Settings, get_settings
from backend.app.main import app


def test_health_check_reports_mock_provider_without_api_key() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None,
        dashscope_api_key=None,
    )

    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "qiniu-ai-interpreter",
        "version": "0.1.0",
        "ai_provider": "mock",
    }

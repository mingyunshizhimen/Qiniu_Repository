from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.glossary import get_glossary_service


def test_glossary_api_crud_flow() -> None:
    glossary_service = get_glossary_service()
    glossary_service.clear()

    try:
        with TestClient(app) as client:
            create_response = client.post(
                "/api/v1/glossary/terms",
                json={
                    "source_term": "七牛云",
                    "target_term": "Qiniu Cloud",
                    "description": "品牌名",
                },
            )
            assert create_response.status_code == 201
            created = create_response.json()
            assert created["source_term"] == "七牛云"
            assert created["target_term"] == "Qiniu Cloud"
            assert created["description"] == "品牌名"
            assert created["enabled"] is True

            list_response = client.get("/api/v1/glossary/terms")
            assert list_response.status_code == 200
            listed = list_response.json()
            assert len(listed) == 1
            assert listed[0]["id"] == created["id"]

            toggle_response = client.patch(
                f"/api/v1/glossary/terms/{created['id']}",
                json={"enabled": False},
            )
            assert toggle_response.status_code == 200
            assert toggle_response.json()["enabled"] is False

            enabled_response = client.get(
                "/api/v1/glossary/terms",
                params={"enabled_only": "true"},
            )
            assert enabled_response.status_code == 200
            assert enabled_response.json() == []

            delete_response = client.delete(
                f"/api/v1/glossary/terms/{created['id']}"
            )
            assert delete_response.status_code == 204

            empty_response = client.get("/api/v1/glossary/terms")
            assert empty_response.status_code == 200
            assert empty_response.json() == []
    finally:
        glossary_service.clear()


def test_glossary_api_returns_not_found_for_unknown_term() -> None:
    with TestClient(app) as client:
        response = client.patch(
            "/api/v1/glossary/terms/missing-term",
            json={"enabled": False},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Glossary term not found."

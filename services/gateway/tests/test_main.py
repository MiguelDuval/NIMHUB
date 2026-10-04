from fastapi.testclient import TestClient

from nimhub_gateway.main import app


client = TestClient(app)


def test_health_reports_mcp_server_count_without_exposing_configuration() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["mcp_servers_configured"] >= 0
    assert "MCP_SERVERS_JSON" not in response.text
    assert "GITHUB_PERSONAL_ACCESS_TOKEN" not in response.text


def test_mcp_servers_endpoint_is_safe_by_default() -> None:
    response = client.get("/api/mcp/servers")

    assert response.status_code == 200
    assert response.json()["servers"] == []


def test_agent_requires_gateway_side_nvidia_configuration() -> None:
    response = client.post(
        "/api/agent",
        json={
            "model": "test-model",
            "messages": [{"role": "user", "content": "hello"}],
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "NVIDIA_NOT_CONFIGURED"

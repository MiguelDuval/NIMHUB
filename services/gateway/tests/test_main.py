from fastapi.testclient import TestClient

from nimhub_gateway.main import agent_runtime, app, nim
from nimhub_gateway.settings import settings


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

def test_agent_stream_endpoint_emits_real_sse_frame_separators(monkeypatch) -> None:
    monkeypatch.setattr(settings, "nvidia_api_key", "test-key")

    async def fake_stream(_request):
        yield {
            "type": "done",
            "turns": 1,
            "response": {"choices": []},
            "messages": [],
        }

    monkeypatch.setattr(agent_runtime, "stream", fake_stream)

    with client.stream(
        "POST",
        "/api/agent",
        json={
            "model": "test-model",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": True,
        },
    ) as response:
        body = b"".join(response.iter_bytes())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert b"data: {\"type\": \"done\", \"turns\": 1" in body
    assert body.endswith(b"\n\n")


def test_cors_allows_capacitor_android_origin() -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "https://localhost",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://localhost"


def test_nvidia_settings_require_server_admin_token() -> None:
    response = client.put(
        "/api/settings/nvidia",
        json={
            "api_key": "nvapi-test",
            "base_url": "https://integrate.api.nvidia.com/v1",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "NIM_HUB_ADMIN_NOT_CONFIGURED"


def test_nvidia_settings_reject_invalid_admin_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "nim_hub_admin_token", "expected-token")

    response = client.put(
        "/api/settings/nvidia",
        headers={"X-NIM-Hub-Admin-Token": "wrong-token"},
        json={
            "api_key": "nvapi-test",
            "base_url": "https://integrate.api.nvidia.com/v1",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "NIM_HUB_ADMIN_UNAUTHORIZED"


def test_nvidia_settings_verify_before_persisting(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "nim_hub_admin_token", "expected-token")
    monkeypatch.setattr(settings, "nim_hub_env_file", str(tmp_path / ".env"))
    async def fake_list_models(**_kwargs):
        return {"object": "list", "data": [{"id": "nvidia/test"}]}

    monkeypatch.setattr(nim, "list_models", fake_list_models)

    response = client.put(
        "/api/settings/nvidia",
        headers={"X-NIM-Hub-Admin-Token": "expected-token"},
        json={
            "api_key": "nvapi-test",
            "base_url": "https://integrate.api.nvidia.com/v1",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["nvidia_configured"] is True
    assert body["models_available"] == 1
    assert body["nvidia_base_url"] == "https://integrate.api.nvidia.com/v1"
    assert "nvapi-test" in (tmp_path / ".env").read_text()
    assert response.text.count("nvapi-test") == 0

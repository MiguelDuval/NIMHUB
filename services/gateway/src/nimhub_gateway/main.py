import json
import secrets

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agent import AgentRunRequest, AgentRuntime
from .mcp import (
    MCPApprovalRequired,
    MCPConfigError,
    MCPPolicyError,
    MCPRegistry,
    MCPToolCallRequest,
    to_client_summary,
)
from .nvidia import NIMClient
from .settings import normalize_nvidia_base_url, persist_nvidia_settings, settings

app = FastAPI(title="NIM Hub Gateway", version="0.1.0")

def _allowed_origins() -> list[str]:
    values = [
        settings.nim_hub_allowed_origin,
        *settings.nim_hub_allowed_origins.split(","),
    ]
    return list(dict.fromkeys(value.strip() for value in values if value.strip()))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

nim = NIMClient()
mcp_registry = MCPRegistry.from_json(settings.mcp_servers_json)
agent_runtime = AgentRuntime(nim, mcp_registry)


class ChatRequest(BaseModel):
    model: str
    messages: list[dict]
    stream: bool = False
    temperature: float | None = None


class NvidiaSettingsRequest(BaseModel):
    api_key: str
    base_url: str


class NvidiaSettingsResponse(BaseModel):
    ok: bool
    nvidia_configured: bool
    nvidia_base_url: str
    models_available: int


def _mcp_error(exc: Exception, *, code: str, status: int) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={
            "code": code,
            "message": str(exc),
            "retryable": False,
        },
    )


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "nim-hub-gateway",
        "nvidia_configured": bool(settings.nvidia_api_key),
        "nvidia_base_url": settings.nvidia_base_url,
        "admin_configured": bool(settings.nim_hub_admin_token),
        "mcp_servers_configured": len(mcp_registry.server_summaries()),
    }


@app.put("/api/settings/nvidia", response_model=NvidiaSettingsResponse)
async def update_nvidia_settings(
    request: NvidiaSettingsRequest,
    admin_token: str | None = Header(default=None, alias="X-NIM-Hub-Admin-Token"),
) -> NvidiaSettingsResponse:
    configured_token = settings.nim_hub_admin_token
    if not configured_token:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NIM_HUB_ADMIN_NOT_CONFIGURED",
                "message": "NIM_HUB_ADMIN_TOKEN is not configured on the gateway",
                "retryable": False,
            },
        )
    if not admin_token or not secrets.compare_digest(admin_token, configured_token):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "NIM_HUB_ADMIN_UNAUTHORIZED",
                "message": "Gateway admin authorization failed",
                "retryable": False,
            },
        )
    if not request.api_key.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "NVIDIA_API_KEY_INVALID",
                "message": "NVIDIA API key is required",
                "retryable": False,
            },
        )

    try:
        base_url = normalize_nvidia_base_url(request.base_url)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "NVIDIA_BASE_URL_INVALID",
                "message": str(exc),
                "retryable": False,
            },
        ) from exc

    try:
        probe = await nim.list_models(
            api_key=request.api_key.strip(),
            base_url=base_url,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "NVIDIA_AUTH_FAILED",
                    "message": "NVIDIA API credentials were rejected",
                    "retryable": False,
                },
            ) from exc
        raise HTTPException(
            status_code=502,
            detail={
                "code": "NVIDIA_VERIFY_FAILED",
                "message": "Gateway could not verify the NVIDIA API endpoint",
                "retryable": True,
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "NVIDIA_VERIFY_FAILED",
                "message": "Gateway could not verify the NVIDIA API endpoint",
                "retryable": True,
            },
        ) from exc

    try:
        persist_nvidia_settings(request.api_key.strip(), base_url)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "NVIDIA_SETTINGS_PERSIST_FAILED",
                "message": "Gateway could not persist NVIDIA settings",
                "retryable": False,
            },
        ) from exc

    settings.nvidia_api_key = request.api_key.strip()
    settings.nvidia_base_url = base_url
    return NvidiaSettingsResponse(
        ok=True,
        nvidia_configured=True,
        nvidia_base_url=base_url,
        models_available=len(probe.get("data") or []),
    )


@app.get("/api/models")
async def models(
    nvidia_api_key: str | None = Header(default=None, alias="X-NVIDIA-API-Key"),
) -> dict:
    try:
        return await nim.list_models(api_key=nvidia_api_key)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NVIDIA_NOT_CONFIGURED",
                "message": str(exc),
                "retryable": False,
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "NVIDIA_MODELS_FAILED",
                "message": str(exc),
                "retryable": True,
            },
        ) from exc


@app.post("/api/chat")
async def chat(
    request: ChatRequest,
    nvidia_api_key: str | None = Header(default=None, alias="X-NVIDIA-API-Key"),
):
    payload = request.model_dump(exclude_none=True)
    # Validate API key early to return proper HTTP error before streaming starts.
    if not settings.nvidia_api_key and not nvidia_api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NVIDIA_NOT_CONFIGURED",
                "message": "NVIDIA API key is not configured",
                "retryable": False,
            },
        )
    try:
        if request.stream:
            return StreamingResponse(
                nim.chat_stream(payload, api_key=nvidia_api_key)
                if nvidia_api_key is not None
                else nim.chat_stream(payload),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        if nvidia_api_key is not None:
            return await nim.chat(payload, api_key=nvidia_api_key)
        return await nim.chat(payload)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NVIDIA_NOT_CONFIGURED",
                "message": str(exc),
                "retryable": False,
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "NVIDIA_CHAT_FAILED",
                "message": str(exc),
                "retryable": True,
            },
        ) from exc


@app.get("/api/mcp/servers")
async def mcp_servers():
    """Return server metadata with credentials/configuration fully redacted."""
    return {"servers": [item.model_dump() for item in mcp_registry.server_summaries()]}


@app.get("/api/mcp/tools")
async def mcp_tools():
    """Discover current MCP tools and return only safe client metadata."""
    try:
        definitions = await mcp_registry.list_all_tools()
        return {
            "tools": [
                to_client_summary(tool).model_dump()
                for tool in definitions
            ]
        }
    except MCPConfigError as exc:
        raise _mcp_error(exc, code="MCP_DISCOVERY_FAILED", status=400) from exc
    except Exception as exc:
        raise _mcp_error(exc, code="MCP_DISCOVERY_FAILED", status=502) from exc


@app.post("/api/mcp/call")
async def mcp_call(request: MCPToolCallRequest):
    try:
        return await mcp_registry.call_tool(request)
    except MCPApprovalRequired as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "MCP_APPROVAL_REQUIRED",
                "message": str(exc),
                "retryable": False,
                "tool": exc.tool.qualified_name,
                "arguments_sha256": exc.arguments_sha256,
                "approval_token": exc.approval_token,
            },
        ) from exc
    except MCPPolicyError as exc:
        raise _mcp_error(exc, code="MCP_POLICY_DENIED", status=403) from exc
    except MCPConfigError as exc:
        raise _mcp_error(exc, code="MCP_CALL_INVALID", status=400) from exc
    except Exception as exc:
        # Tool execution failures are normally represented by CallToolResult.is_error.
        # Connection/protocol failures still become a gateway error.
        raise _mcp_error(exc, code="MCP_CALL_FAILED", status=502) from exc


@app.post("/api/agent")
async def agent(
    request: AgentRunRequest,
    nvidia_api_key: str | None = Header(default=None, alias="X-NVIDIA-API-Key"),
):
    if not settings.nvidia_api_key and not nvidia_api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NVIDIA_NOT_CONFIGURED",
                "message": "NVIDIA API key is not configured on the gateway or supplied by the client",
                "retryable": False,
            },
        )

    if request.stream:
        async def event_stream():
            try:
                stream = (
                    agent_runtime.stream(request, api_key=nvidia_api_key)
                    if nvidia_api_key is not None
                    else agent_runtime.stream(request)
                )
                async for event in stream:
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            except MCPConfigError as exc:
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "error",
                            "code": "MCP_AGENT_FAILED",
                            "message": str(exc),
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )
            except Exception as exc:
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "error",
                            "code": "AGENT_FAILED",
                            "message": str(exc),
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        if nvidia_api_key is not None:
            return await agent_runtime.run(request, api_key=nvidia_api_key)
        return await agent_runtime.run(request)
    except MCPConfigError as exc:
        raise _mcp_error(exc, code="MCP_AGENT_FAILED", status=400) from exc
    except Exception as exc:
        raise _mcp_error(exc, code="AGENT_FAILED", status=502) from exc

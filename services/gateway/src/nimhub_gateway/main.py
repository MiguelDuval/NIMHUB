import json

from fastapi import FastAPI, HTTPException
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
    MCPToolSummary,
    to_client_summary,
)
from .nvidia import NIMClient
from .settings import settings

app = FastAPI(title="NIM Hub Gateway", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.nim_hub_allowed_origin],
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
        "mcp_servers_configured": len(mcp_registry.server_summaries()),
    }


@app.get("/api/models")
async def models() -> dict:
    try:
        return await nim.list_models()
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
async def chat(request: ChatRequest):
    payload = request.model_dump(exclude_none=True)
    # Validate API key early to return proper HTTP error before streaming starts.
    if not settings.nvidia_api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NVIDIA_NOT_CONFIGURED",
                "message": "NVIDIA_API_KEY is not configured",
                "retryable": False,
            },
        )
    try:
        if request.stream:
            return StreamingResponse(
                nim.chat_stream(payload),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
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
async def agent(request: AgentRunRequest):
    if not settings.nvidia_api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "NVIDIA_NOT_CONFIGURED",
                "message": "NVIDIA_API_KEY is not configured",
                "retryable": False,
            },
        )

    if request.stream:
        async def event_stream():
            try:
                async for event in agent_runtime.stream(request):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\\n\\n"
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
                    + "\\n\\n"
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
                    + "\\n\\n"
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
        return await agent_runtime.run(request)
    except MCPConfigError as exc:
        raise _mcp_error(exc, code="MCP_AGENT_FAILED", status=400) from exc
    except Exception as exc:
        raise _mcp_error(exc, code="AGENT_FAILED", status=502) from exc

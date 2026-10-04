import json
from collections.abc import AsyncIterator

import pytest

from nimhub_gateway.agent import AgentRunRequest, AgentRuntime
from nimhub_gateway.mcp import MCPApprovalGrant, MCPRegistry, MCPServerConfig, canonical_arguments_sha256
from tests.test_mcp import SERVER


def registry(permission: str = "read") -> MCPRegistry:
    import sys

    return MCPRegistry(
        [
            MCPServerConfig(
                id="deterministic",
                transport="stdio",
                permission=permission,
                command=sys.executable,
                args=[str(SERVER)],
            )
        ]
    )


def tool_call(model_name: str, call_id: str, value: str) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {
            "name": model_name,
            "arguments": json.dumps({"value": value}),
        },
    }


class FakeNIM:
    def __init__(self, responses: list[dict]):
        self.responses = list(responses)
        self.payloads: list[dict] = []

    async def chat(self, payload: dict) -> dict:
        self.payloads.append(payload)
        if not self.responses:
            raise AssertionError("FakeNIM received more turns than expected")
        return self.responses.pop(0)

    async def chat_stream(self, payload: dict) -> AsyncIterator[bytes]:
        self.payloads.append(payload)
        chunks = [
            {
                "id": "stream-1",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": payload["model"],
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": "hel"}, "finish_reason": None}],
            },
            {
                "id": "stream-1",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": payload["model"],
                "choices": [{"index": 0, "delta": {"content": "lo"}, "finish_reason": "stop"}],
            },
        ]
        for chunk in chunks:
            yield (f"data: {json.dumps(chunk)}\n\n").encode()
        yield b"data: [DONE]\n\n"


@pytest.mark.asyncio
async def test_agent_executes_tool_then_continues_model_turn() -> None:
    reg = registry()
    discovered = await reg.list_all_tools()
    echo = next(tool for tool in discovered if tool.name == "deterministic_echo")

    first = {
        "id": "chat-1",
        "object": "chat.completion",
        "created": 1,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [tool_call(echo.model_name, "call-1", "hello")],
            },
            "finish_reason": "tool_calls",
        }],
    }
    second = {
        "id": "chat-2",
        "object": "chat.completion",
        "created": 2,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "done"},
            "finish_reason": "stop",
        }],
    }

    nim = FakeNIM([first, second])
    result = await AgentRuntime(nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=[{"role": "user", "content": "echo hello"}],
        )
    )

    assert result.status == "completed"
    assert result.turns == 2
    assert result.response == second
    assert result.messages[-1]["content"] == "done"
    assert result.messages[-2]["role"] == "tool"
    assert "deterministic:hello" in result.messages[-2]["content"]


@pytest.mark.asyncio
async def test_agent_supports_multiple_tool_calls_in_one_turn() -> None:
    reg = registry()
    echo = next(tool for tool in await reg.list_all_tools() if tool.name == "deterministic_echo")
    first = {
        "id": "chat-1",
        "object": "chat.completion",
        "created": 1,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    tool_call(echo.model_name, "call-1", "a"),
                    tool_call(echo.model_name, "call-2", "b"),
                ],
            },
            "finish_reason": "tool_calls",
        }],
    }
    second = {
        "id": "chat-2",
        "object": "chat.completion",
        "created": 2,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "two tools completed"},
            "finish_reason": "stop",
        }],
    }

    nim = FakeNIM([first, second])
    result = await AgentRuntime(nim, reg).run(
        AgentRunRequest(model="test-model", messages=[{"role": "user", "content": "two"}])
    )

    tool_messages = [message for message in result.messages if message["role"] == "tool"]
    assert result.status == "completed"
    assert len(tool_messages) == 2
    assert "deterministic:a" in tool_messages[0]["content"]
    assert "deterministic:b" in tool_messages[1]["content"]


@pytest.mark.asyncio
async def test_tool_error_becomes_conversation_state_and_loop_recovers() -> None:
    reg = registry()
    first = {
        "id": "chat-1",
        "object": "chat.completion",
        "created": 1,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [tool_call("does-not-exist", "call-1", "x")],
            },
            "finish_reason": "tool_calls",
        }],
    }
    second = {
        "id": "chat-2",
        "object": "chat.completion",
        "created": 2,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "recovered"},
            "finish_reason": "stop",
        }],
    }

    nim = FakeNIM([first, second])
    result = await AgentRuntime(nim, reg).run(
        AgentRunRequest(model="test-model", messages=[{"role": "user", "content": "recover"}])
    )

    assert result.status == "completed"
    assert result.turns == 2
    assert result.messages[-2]["role"] == "tool"
    assert '"ok": false' in result.messages[-2]["content"]
    assert result.messages[-1]["content"] == "recovered"


@pytest.mark.asyncio
async def test_destructive_tool_stops_for_exact_approval_without_execution() -> None:
    reg = registry(permission="destructive")
    protected = next(tool for tool in await reg.list_all_tools() if tool.name == "protected_write")
    response = {
        "id": "chat-1",
        "object": "chat.completion",
        "created": 1,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [tool_call(protected.model_name, "call-1", "danger")],
            },
            "finish_reason": "tool_calls",
        }],
    }

    nim = FakeNIM([response])
    runtime = AgentRuntime(nim, reg)
    result = await runtime.run(
        AgentRunRequest(model="test-model", messages=[{"role": "user", "content": "write"}])
    )

    assert result.status == "approval_required"
    assert len(result.approvals) == 1
    assert result.approvals[0].tool == protected.qualified_name
    assert result.approvals[0].arguments_sha256 == canonical_arguments_sha256({"value": "danger"})
    assert len(nim.payloads) == 1


@pytest.mark.asyncio
async def test_exact_approval_allows_continuation() -> None:
    reg = registry(permission="destructive")
    protected = next(tool for tool in await reg.list_all_tools() if tool.name == "protected_write")
    call = tool_call(protected.model_name, "call-1", "danger")
    first = {
        "id": "chat-1",
        "object": "chat.completion",
        "created": 1,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": None, "tool_calls": [call]},
            "finish_reason": "tool_calls",
        }],
    }
    final = {
        "id": "chat-2",
        "object": "chat.completion",
        "created": 2,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "approved"},
            "finish_reason": "stop",
        }],
    }
    arguments = {"value": "danger"}
    grant = MCPApprovalGrant(
        tool=protected.qualified_name,
        arguments_sha256=canonical_arguments_sha256(arguments),
    )

    nim = FakeNIM([first, final])
    result = await AgentRuntime(nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=[{"role": "user", "content": "write"}],
            approval_grants=[grant],
        )
    )

    assert result.status == "completed"
    assert result.turns == 2
    tool_message = result.messages[-2]
    assert tool_message["role"] == "tool"
    assert "protected:danger" in tool_message["content"]


@pytest.mark.asyncio
async def test_streaming_yields_deltas_and_final_event() -> None:
    reg = registry()
    nim = FakeNIM([])
    events = [
        event
        async for event in AgentRuntime(nim, reg).stream(
            AgentRunRequest(
                model="test-model",
                messages=[{"role": "user", "content": "hello"}],
                stream=True,
            )
        )
    ]

    assert [event["type"] for event in events] == ["content_delta", "content_delta", "done"]
    assert "".join(event.get("text", "") for event in events if event["type"] == "content_delta") == "hello"
    assert events[-1]["response"]["choices"][0]["finish_reason"] == "stop"

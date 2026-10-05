import copy
import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from nimhub_gateway.agent import AgentRunRequest, AgentRuntime
from nimhub_gateway.mcp import (
    MCPApprovalGrant,
    MCPRegistry,
    MCPServerConfig,
    MCPToolDefinition,
    canonical_arguments_sha256,
)

SERVER = Path(__file__).with_name("deterministic_mcp_server.py")


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


class StreamingErrorNIM:
    def __init__(self) -> None:
        self.payloads: list[dict] = []

    async def chat_stream(self, payload: dict) -> AsyncIterator[bytes]:
        self.payloads.append(copy.deepcopy(payload))
        if len(self.payloads) == 1:
            yield (
                b'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,'
                b'"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant",'
                b'"tool_calls":[{"index":0,"id":"call-1","type":"function","function":'
                b'{"name":"does-not-exist","arguments":"{\\"value\\":\\"x\\"}"}}]},'
                b'"finish_reason":"tool_calls"}]}\n\n'
            )
            yield b'data: [DONE]\n\n'
            return

        yield (
            b'data: {"id":"chat-2","object":"chat.completion.chunk","created":2,'
            b'"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant",'
            b'"content":"recovered"},"finish_reason":"stop"}]}\n\n'
        )
        yield b'data: [DONE]\n\n'


class FakeNIM:
    def __init__(self, responses: list[dict]):
        self.responses = list(responses)
        self.payloads: list[dict] = []

    async def chat(self, payload: dict) -> dict:
        self.payloads.append(copy.deepcopy(payload))
        if not self.responses:
            raise AssertionError("FakeNIM received more turns than expected")
        return self.responses.pop(0)

    async def chat_stream(self, payload: dict) -> AsyncIterator[bytes]:
        self.payloads.append(copy.deepcopy(payload))
        yield b'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hel"},"finish_reason":null}]}\n\n'
        yield b'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n'
        yield b'data: [DONE]\n\n'


@pytest.mark.asyncio
async def test_agent_executes_tool_then_continues() -> None:
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
        AgentRunRequest(model="test-model", messages=[{"role": "user", "content": "hello"}])
    )

    assert result.status == "completed"
    assert result.turns == 2
    assert result.response is not None
    assert result.response["choices"][0]["message"]["content"] == "done"
    assert result.messages[-2]["role"] == "tool"
    assert "deterministic:hello" in result.messages[-2]["content"]


@pytest.mark.asyncio
async def test_multiple_tool_calls_execute_without_short_circuit() -> None:
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
            "message": {"role": "assistant", "content": "two"},
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
    assert result.approvals[0].tool_call_id == "call-1"
    assert result.approvals[0].arguments_sha256 == canonical_arguments_sha256({"value": "danger"})
    assert len(result.approvals[0].approval_token) >= 32
    assert len(nim.payloads) == 1


@pytest.mark.asyncio
async def test_exact_approval_executes_original_call_before_model_resume() -> None:
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

    first_nim = FakeNIM([first])
    first_result = await AgentRuntime(first_nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=[{"role": "user", "content": "write"}],
        )
    )
    assert first_result.status == "approval_required"
    approval = first_result.approvals[0]
    grant = MCPApprovalGrant(
        approval_token=approval.approval_token,
        arguments_sha256=approval.arguments_sha256,
    )

    nim = FakeNIM([final])
    result = await AgentRuntime(nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=first_result.messages,
            approval_grants=[grant],
        )
    )

    assert result.status == "completed"
    assert result.turns == 1
    assert result.messages[-2]["role"] == "tool"
    assert "protected:danger" in result.messages[-2]["content"]
    assert result.messages[-1]["content"] == "approved"
    assert len(nim.payloads) == 1
    assert nim.payloads[0]["messages"][-1]["role"] == "tool"


@pytest.mark.asyncio
async def test_approval_continuation_skips_completed_sibling_tool_errors() -> None:
    reg = registry(permission="destructive")
    protected = next(tool for tool in await reg.list_all_tools() if tool.name == "protected_write")
    calls = [
        tool_call("does-not-exist", "call-bad", "bad"),
        tool_call(protected.model_name, "call-write", "danger"),
    ]
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
                "tool_calls": calls,
            },
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
            "message": {"role": "assistant", "content": "recovered"},
            "finish_reason": "stop",
        }],
    }

    first_nim = FakeNIM([first])
    runtime = AgentRuntime(first_nim, reg)
    first_result = await runtime.run(
        AgentRunRequest(
            model="test-model",
            messages=[{"role": "user", "content": "mixed"}],
        )
    )

    assert first_result.status == "approval_required"
    assert len(first_result.approvals) == 1
    assert first_result.messages[-1]["role"] == "tool"
    assert first_result.messages[-1]["tool_call_id"] == "call-bad"

    approval = first_result.approvals[0]
    grant = MCPApprovalGrant(
        approval_token=approval.approval_token,
        arguments_sha256=approval.arguments_sha256,
    )

    nim = FakeNIM([final])
    result = await AgentRuntime(nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=first_result.messages,
            approval_grants=[grant],
        )
    )

    assert result.status == "completed"
    tool_messages = [message for message in result.messages if message["role"] == "tool"]
    assert len(tool_messages) == 2
    assert tool_messages[0]["tool_call_id"] == "call-bad"
    assert tool_messages[1]["tool_call_id"] == "call-write"
    assert "protected:danger" in tool_messages[1]["content"]
    assert result.messages[-1]["content"] == "recovered"
    assert len(nim.payloads) == 1

@pytest.mark.asyncio
async def test_denied_tool_result_can_resume_agent_without_reapproval() -> None:
    reg = registry(permission="destructive")
    protected = next(tool for tool in await reg.list_all_tools() if tool.name == "protected_write")
    call = tool_call(protected.model_name, "call-denied", "danger")
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

    first_nim = FakeNIM([first])
    first_result = await AgentRuntime(first_nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=[{"role": "user", "content": "write"}],
        )
    )
    assert first_result.status == "approval_required"

    denied_messages = first_result.messages + [{
        "role": "tool",
        "tool_call_id": "call-denied",
        "content": json.dumps({"ok": False, "error": "User denied this tool call."}),
    }]
    final = {
        "id": "chat-2",
        "object": "chat.completion",
        "created": 2,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "I will use a safe alternative."},
            "finish_reason": "stop",
        }],
    }

    nim = FakeNIM([final])
    result = await AgentRuntime(nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=denied_messages,
        )
    )

    assert result.status == "completed"
    assert result.messages[-2]["tool_call_id"] == "call-denied"
    assert "User denied this tool call." in result.messages[-2]["content"]
    assert result.messages[-1]["content"] == "I will use a safe alternative."
    assert len(nim.payloads) == 1
    assert nim.payloads[0]["messages"][-1]["role"] == "tool"


@pytest.mark.asyncio
async def test_streaming_approval_executes_original_call_before_model_resume() -> None:
    reg = registry(permission="destructive")
    protected = next(tool for tool in await reg.list_all_tools() if tool.name == "protected_write")
    call = tool_call(protected.model_name, "call-1", "danger")
    first_response = {
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

    first_nim = FakeNIM([first_response])
    first_result = await AgentRuntime(first_nim, reg).run(
        AgentRunRequest(
            model="test-model",
            messages=[{"role": "user", "content": "write"}],
        )
    )
    approval = first_result.approvals[0]
    grant = MCPApprovalGrant(
        approval_token=approval.approval_token,
        arguments_sha256=approval.arguments_sha256,
    )

    nim = FakeNIM([])
    events = [
        event
        async for event in AgentRuntime(nim, reg).stream(
            AgentRunRequest(
                model="test-model",
                messages=first_result.messages,
                approval_grants=[grant],
                stream=True,
            )
        )
    ]

    assert events[0]["type"] == "tool_result"
    assert events[0]["tool"] == protected.qualified_name
    assert [event["type"] for event in events[1:]] == ["content_delta", "content_delta", "done"]
    assert "".join(event.get("text", "") for event in events if event["type"] == "content_delta") == "hello"


@pytest.mark.asyncio
async def test_streaming_tool_error_is_persisted_for_model_recovery() -> None:
    reg = registry()
    nim = StreamingErrorNIM()

    events = [
        event
        async for event in AgentRuntime(nim, reg).stream(
            AgentRunRequest(
                model="test-model",
                messages=[{"role": "user", "content": "recover"}],
                stream=True,
            )
        )
    ]

    assert any(event["type"] == "tool_error" for event in events)
    assert [event["type"] for event in events[-2:]] == ["content_delta", "done"]
    assert "recovered" in "".join(
        event.get("text", "") for event in events if event["type"] == "content_delta"
    )
    assert len(nim.payloads) == 2
    second_messages = nim.payloads[1]["messages"]
    assert second_messages[-1]["role"] == "tool"
    assert '"ok": false' in second_messages[-1]["content"]


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

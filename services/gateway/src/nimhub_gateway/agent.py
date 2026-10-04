"""Deterministic gateway agent/tool loop.

The runtime owns the model <-> MCP conversation turn sequence. It discovers MCP
tools at runtime, passes only normalized tool schemas to the model, validates
and authorizes every requested call, continues after tool failures, and can
stream model content/tool events over SSE.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .mcp import (
    MCPApprovalGrant,
    MCPApprovalRequired,
    MCPConfigError,
    MCPPolicyError,
    MCPRegistry,
    MCPToolDefinition,
    MCPToolCallRequest,
    MCPToolResult,
)
from .nvidia import NIMClient


AgentStatus = Literal["completed", "approval_required", "max_turns", "error"]


class AgentApprovalRequest(BaseModel):
    """A client-safe description of a blocked model-requested tool call."""

    tool: str
    tool_call_id: str
    model_name: str
    description: str | None
    arguments: dict[str, Any]
    arguments_sha256: str
    approval_token: str
    destructive: bool | None
    permission: str


class AgentRunRequest(BaseModel):
    """Input for the generic model/MCP agent loop."""

    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    messages: list[dict[str, Any]]
    stream: bool = False
    temperature: float | None = 0.7
    tool_choice: str | dict[str, Any] | None = "auto"
    max_turns: int = Field(default=8, ge=1, le=12)
    approval_grants: list[MCPApprovalGrant] = Field(default_factory=list)


class AgentRunResponse(BaseModel):
    """Non-streaming agent result plus the exact continuation state."""

    status: AgentStatus
    response: dict[str, Any] | None = None
    messages: list[dict[str, Any]]
    approvals: list[AgentApprovalRequest] = Field(default_factory=list)
    turns: int


class AgentRuntime:
    """Small, provider-specific-free model/tool orchestration engine."""

    def __init__(self, nim: NIMClient, mcp: MCPRegistry):
        self.nim = nim
        self.mcp = mcp

    @staticmethod
    def _openai_tool(tool: MCPToolDefinition) -> dict[str, Any]:
        description = tool.description or f"MCP tool {tool.qualified_name}"
        return {
            "type": "function",
            "function": {
                "name": tool.model_name,
                "description": description[:4000],
                "parameters": tool.input_schema,
            },
        }

    @staticmethod
    def _assistant_message(response: dict[str, Any]) -> dict[str, Any]:
        choice = (response.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        return {
            "role": "assistant",
            "content": message.get("content"),
            **(
                {"tool_calls": message["tool_calls"]}
                if message.get("tool_calls")
                else {}
            ),
        }

    @staticmethod
    def _tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
        choice = (response.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        calls = message.get("tool_calls") or []
        return [call for call in calls if isinstance(call, dict)]

    @staticmethod
    def _parse_arguments(call: dict[str, Any]) -> dict[str, Any]:
        function = call.get("function") or {}
        raw = function.get("arguments", "{}")
        if isinstance(raw, dict):
            return raw
        if not isinstance(raw, str):
            raise MCPConfigError("Model returned non-string tool arguments")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise MCPConfigError("Model tool arguments must be a JSON object")
        return value

    @staticmethod
    def _tool_error_message(
        call: dict[str, Any],
        message: str,
    ) -> dict[str, Any]:
        return {
            "role": "tool",
            "tool_call_id": str(call.get("id") or "unknown"),
            "content": json.dumps(
                {"ok": False, "error": message},
                ensure_ascii=False,
            ),
        }

    @staticmethod
    def _tool_result_message(
        call: dict[str, Any],
        result: MCPToolResult,
    ) -> dict[str, Any]:
        payload = {
            "ok": not result.is_error,
            "content": result.content,
        }
        if result.structured_content is not None:
            payload["structuredContent"] = result.structured_content
        return {
            "role": "tool",
            "tool_call_id": str(call.get("id") or "unknown"),
            "content": json.dumps(payload, ensure_ascii=False)[:32000],
        }

    @staticmethod
    def _approval_request(
        tool: MCPToolDefinition,
        tool_call_id: str,
        arguments: dict[str, Any],
        arguments_sha256: str,
        approval_token: str,
    ) -> AgentApprovalRequest:
        return AgentApprovalRequest(
            tool=tool.qualified_name,
            tool_call_id=tool_call_id,
            model_name=tool.model_name,
            description=tool.description,
            arguments=arguments,
            arguments_sha256=arguments_sha256,
            approval_token=approval_token,
            destructive=tool.destructive,
            permission=tool.permission,
        )

    async def _discover(self) -> tuple[list[MCPToolDefinition], dict[str, MCPToolDefinition]]:
        definitions = await self.mcp.list_all_tools()
        by_model_name = {tool.model_name: tool for tool in definitions}
        return definitions, by_model_name

    async def _prepare_approved_continuation(
        self,
        messages: list[dict[str, Any]],
        by_model_name: dict[str, MCPToolDefinition],
        grants: list[MCPApprovalGrant],
    ) -> tuple[
        list[tuple[dict[str, Any], MCPToolDefinition, dict[str, Any]]],
        list[AgentApprovalRequest],
    ]:
        if not grants or not messages:
            return [], []

        assistant = messages[-1]
        if assistant.get("role") != "assistant":
            return [], []

        raw_calls = assistant.get("tool_calls") or []
        calls = [call for call in raw_calls if isinstance(call, dict)]
        if not calls:
            return [], []

        completed_call_ids = {
            str(message.get("tool_call_id"))
            for message in messages
            if message.get("role") == "tool" and message.get("tool_call_id")
        }

        pending: list[AgentApprovalRequest] = []
        executable: list[tuple[dict[str, Any], MCPToolDefinition, dict[str, Any]]] = []

        for call in calls:
            call_id = str(call.get("id") or "")
            if call_id and call_id in completed_call_ids:
                continue
            function = call.get("function") or {}
            model_name = str(function.get("name") or "")
            tool = by_model_name.get(model_name)
            if tool is None:
                raise MCPConfigError(
                    f"Unknown model tool in approval continuation: {model_name}"
                )

            arguments = self._parse_arguments(call)
            try:
                await self.mcp.authorize_tool_call(tool, arguments, grants)
            except MCPApprovalRequired as exc:
                pending.append(
                    self._approval_request(
                        tool,
                        str(call.get("id") or "unknown"),
                        arguments,
                        exc.arguments_sha256,
                        exc.approval_token,
                    )
                )
            else:
                executable.append((call, tool, arguments))

        return executable, pending

    async def _execute_approved_calls(
        self,
        executable: list[tuple[dict[str, Any], MCPToolDefinition, dict[str, Any]]],
        messages: list[dict[str, Any]],
        grants: list[MCPApprovalGrant],
    ) -> None:
        for call, tool, arguments in executable:
            result = await self.mcp.call_tool(
                MCPToolCallRequest(
                    tool=tool.qualified_name,
                    arguments=arguments,
                    approval_grants=grants,
                )
            )
            messages.append(self._tool_result_message(call, result))

    async def run(self, request: AgentRunRequest) -> AgentRunResponse:
        messages = list(request.messages)
        definitions, by_model_name = await self._discover()

        if request.approval_grants:
            approved_calls, pending = await self._prepare_approved_continuation(
                messages,
                by_model_name,
                request.approval_grants,
            )
            if pending:
                return AgentRunResponse(
                    status="approval_required",
                    messages=messages,
                    approvals=pending,
                    turns=0,
                )
            if approved_calls:
                try:
                    await self._execute_approved_calls(
                        approved_calls,
                        messages,
                        request.approval_grants,
                    )
                except Exception as exc:
                    for call, _tool, _arguments in approved_calls:
                        messages.append(self._tool_error_message(call, str(exc)))
                    return AgentRunResponse(
                        status="error",
                        messages=messages,
                        turns=0,
                    )

        for turn in range(1, request.max_turns + 1):
            payload: dict[str, Any] = {
                "model": request.model,
                "messages": messages,
                "stream": False,
            }
            if request.temperature is not None:
                payload["temperature"] = request.temperature
            if request.tool_choice is not None and definitions:
                payload["tool_choice"] = request.tool_choice
                payload["tools"] = [self._openai_tool(tool) for tool in definitions]

            try:
                response = await self.nim.chat(payload)
            except Exception:
                return AgentRunResponse(
                    status="error",
                    messages=messages,
                    turns=turn,
                )

            calls = self._tool_calls(response)
            assistant_message = self._assistant_message(response)
            messages.append(assistant_message)

            if not calls:
                return AgentRunResponse(
                    status="completed",
                    response=response,
                    messages=messages,
                    turns=turn,
                )

            pending: list[AgentApprovalRequest] = []
            parsed_calls: list[tuple[dict[str, Any], MCPToolDefinition, dict[str, Any]]] = []
            hard_errors: list[tuple[dict[str, Any], str]] = []

            for call in calls:
                function = call.get("function") or {}
                model_name = str(function.get("name") or "")
                tool = by_model_name.get(model_name)
                if tool is None:
                    hard_errors.append((call, f"Unknown model tool: {model_name}"))
                    continue

                try:
                    arguments = self._parse_arguments(call)
                    arguments_sha256 = await self.mcp.authorize_tool_call(
                        tool,
                        arguments,
                        request.approval_grants,
                    )
                except MCPApprovalRequired as exc:
                    arguments = self._parse_arguments(call)
                    arguments_sha256 = exc.arguments_sha256
                    pending.append(
                        self._approval_request(
                            tool,
                            str(call.get("id") or "unknown"),
                            arguments,
                            arguments_sha256,
                            exc.approval_token,
                        )
                    )
                    parsed_calls.append((call, tool, arguments))
                except (MCPPolicyError, MCPConfigError, json.JSONDecodeError) as exc:
                    hard_errors.append((call, str(exc)))
                else:
                    parsed_calls.append((call, tool, arguments))

            if pending:
                # Preserve errors from sibling tool calls in the same model turn.
                # On approval continuation those completed calls are skipped, so
                # they are never executed or re-validated a second time.
                for call, error in hard_errors:
                    messages.append(self._tool_error_message(call, error))

                # Do not partially execute a model turn containing a blocked write.
                # The returned messages are the exact continuation state; the client
                # can approve the listed hashes and resubmit it unchanged.
                return AgentRunResponse(
                    status="approval_required",
                    messages=messages,
                    approvals=pending,
                    turns=turn,
                )

            for call, tool, arguments in parsed_calls:
                try:
                    result = await self.mcp.call_tool(
                        MCPToolCallRequest(
                            tool=tool.qualified_name,
                            arguments=arguments,
                            approval_grants=request.approval_grants,
                        )
                    )
                except Exception as exc:
                    hard_errors.append((call, str(exc)))
                    continue

                messages.append(self._tool_result_message(call, result))

            for call, error in hard_errors:
                messages.append(self._tool_error_message(call, error))

            # A tool failure is part of the conversation state. The model gets a
            # chance to recover or select another tool on the next turn.
            if not hard_errors and not parsed_calls:
                messages.append(
                    self._tool_error_message(
                        calls[0],
                        "No executable MCP tool call remained after validation.",
                    )
                )

        return AgentRunResponse(
            status="max_turns",
            messages=messages,
            turns=request.max_turns,
        )

    async def stream(self, request: AgentRunRequest) -> AsyncIterator[dict[str, Any]]:
        """Stream content/tool/approval events while running the same loop."""
        messages = list(request.messages)
        definitions, by_model_name = await self._discover()

        if request.approval_grants:
            approved_calls, pending = await self._prepare_approved_continuation(
                messages,
                by_model_name,
                request.approval_grants,
            )
            if pending:
                yield {
                    "type": "approval_required",
                    "approvals": [item.model_dump() for item in pending],
                    "messages": messages,
                    "turns": 0,
                }
                return

            for call, tool, arguments in approved_calls:
                try:
                    result = await self.mcp.call_tool(
                        MCPToolCallRequest(
                            tool=tool.qualified_name,
                            arguments=arguments,
                            approval_grants=request.approval_grants,
                        )
                    )
                    messages.append(self._tool_result_message(call, result))
                    yield {
                        "type": "tool_result",
                        "tool": result.tool,
                        "is_error": result.is_error,
                        "turn": 0,
                    }
                except Exception as exc:
                    messages.append(self._tool_error_message(call, str(exc)))
                    yield self._tool_error_event(call, str(exc))

        for turn in range(1, request.max_turns + 1):
            payload: dict[str, Any] = {
                "model": request.model,
                "messages": messages,
                "stream": True,
            }
            if request.temperature is not None:
                payload["temperature"] = request.temperature
            if request.tool_choice is not None and definitions:
                payload["tool_choice"] = request.tool_choice
                payload["tools"] = [self._openai_tool(tool) for tool in definitions]

            content = ""
            tool_calls: dict[int, dict[str, Any]] = {}
            finish_reason: str | None = None
            final_id: str = ""
            created: int = 0

            try:
                async for raw_line in self.nim.chat_stream(payload):
                    for line in raw_line.decode("utf-8", errors="replace").splitlines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:].strip()
                        if not data or data == "[DONE]":
                            continue
                        chunk = json.loads(data)
                        final_id = str(chunk.get("id") or final_id)
                        created = int(chunk.get("created") or created)
                        choice = (chunk.get("choices") or [{}])[0]
                        delta = choice.get("delta") or {}
                        text_delta = delta.get("content")
                        if isinstance(text_delta, str) and text_delta:
                            content += text_delta
                            yield {"type": "content_delta", "text": text_delta, "turn": turn}

                        for tool_call in delta.get("tool_calls") or []:
                            index = int(tool_call.get("index", len(tool_calls)))
                            current = tool_calls.setdefault(
                                index,
                                {
                                    "id": "",
                                    "type": "function",
                                    "function": {"name": "", "arguments": ""},
                                },
                            )
                            if tool_call.get("id"):
                                current["id"] = tool_call["id"]
                            function = tool_call.get("function") or {}
                            if function.get("name"):
                                current["function"]["name"] = function["name"]
                            if function.get("arguments"):
                                current["function"]["arguments"] += function["arguments"]

                        if choice.get("finish_reason"):
                            finish_reason = choice["finish_reason"]
            except Exception as exc:
                yield {"type": "error", "message": str(exc), "turn": turn}
                return

            calls = [tool_calls[index] for index in sorted(tool_calls)]
            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": content or None,
            }
            if calls:
                assistant_message["tool_calls"] = calls
            messages.append(assistant_message)

            if not calls and finish_reason != "tool_calls":
                response = {
                    "id": final_id or f"agent-{created}",
                    "object": "chat.completion",
                    "created": created,
                    "model": request.model,
                    "choices": [{
                        "index": 0,
                        "message": assistant_message,
                        "finish_reason": finish_reason or "stop",
                    }],
                }
                yield {"type": "done", "response": response, "messages": messages, "turns": turn}
                return

            pending: list[AgentApprovalRequest] = []
            executable: list[tuple[dict[str, Any], MCPToolDefinition, dict[str, Any]]] = []

            for call in calls:
                function = call.get("function") or {}
                tool = by_model_name.get(str(function.get("name") or ""))
                if tool is None:
                    error = f"Unknown model tool: {function.get('name')}"
                    messages.append(self._tool_error_message(call, error))
                    yield self._tool_error_event(call, error)
                    continue

                try:
                    arguments = self._parse_arguments(call)
                    await self.mcp.authorize_tool_call(
                        tool,
                        arguments,
                        request.approval_grants,
                    )
                except MCPApprovalRequired as exc:
                    arguments = self._parse_arguments(call)
                    pending.append(
                        self._approval_request(
                            tool,
                            str(call.get("id") or "unknown"),
                            arguments,
                            exc.arguments_sha256,
                            exc.approval_token,
                        )
                    )
                except Exception as exc:
                    error = str(exc)
                    messages.append(self._tool_error_message(call, error))
                    yield self._tool_error_event(call, error)
                    continue
                else:
                    executable.append((call, tool, arguments))

            if pending:
                yield {
                    "type": "approval_required",
                    "approvals": [item.model_dump() for item in pending],
                    "messages": messages,
                    "turns": turn,
                }
                return

            for call, tool, arguments in executable:
                try:
                    result = await self.mcp.call_tool(
                        MCPToolCallRequest(
                            tool=tool.qualified_name,
                            arguments=arguments,
                            approval_grants=request.approval_grants,
                        )
                    )
                    messages.append(self._tool_result_message(call, result))
                    yield {
                        "type": "tool_result",
                        "tool": result.tool,
                        "is_error": result.is_error,
                        "turn": turn,
                    }
                except Exception as exc:
                    messages.append(self._tool_error_message(call, str(exc)))
                    yield self._tool_error_event(call, str(exc))

            yield {"type": "continue", "turn": turn}

        yield {"type": "max_turns", "messages": messages, "turns": request.max_turns}

    @staticmethod
    def _tool_error_event(call: dict[str, Any], message: str) -> dict[str, Any]:
        function = call.get("function") or {}
        return {
            "type": "tool_error",
            "tool": str(function.get("name") or "unknown"),
            "tool_call_id": str(call.get("id") or "unknown"),
            "message": message,
        }

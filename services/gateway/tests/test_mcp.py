import json
import sys
from pathlib import Path

import pytest

from nimhub_gateway.mcp import (
    MCPApprovalGrant,
    MCPApprovalRequired,
    MCPPolicyError,
    MCPRegistry,
    MCPServerConfig,
    MCPToolCallRequest,
    canonical_arguments_sha256,
)

SERVER = Path(__file__).with_name("deterministic_mcp_server.py")


def registry(permission: str = "read") -> MCPRegistry:
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


def test_parse_mcp_servers_rejects_duplicates() -> None:
    raw = json.dumps(
        [
            {"id": "one", "transport": "stdio", "command": sys.executable},
            {"id": "one", "transport": "stdio", "command": sys.executable},
        ]
    )
    with pytest.raises(ValueError, match="unique"):
        MCPRegistry.from_json(raw)


@pytest.mark.asyncio
async def test_stdio_discovery_and_call_are_end_to_end() -> None:
    reg = registry()
    tools = await reg.list_all_tools()

    assert len(tools) == 1
    tool = tools[0]
    assert tool.qualified_name == "deterministic.deterministic_echo"
    assert tool.read_only is True
    assert tool.requires_approval is False

    result = await reg.call_tool(
        MCPToolCallRequest(
            tool=tool.model_name,
            arguments={"value": "hello"},
        )
    )

    assert result.is_error is False
    assert result.tool == "deterministic.deterministic_echo"
    assert result.content[0]["type"] == "text"
    assert result.content[0]["text"] == "deterministic:hello"


@pytest.mark.asyncio
async def test_invalid_arguments_are_rejected_before_execution() -> None:
    reg = registry()
    tool = (await reg.list_all_tools())[0]

    with pytest.raises(ValueError, match="Invalid arguments"):
        await reg.call_tool(
            MCPToolCallRequest(
                tool=tool.model_name,
                arguments={"unexpected": "value"},
            )
        )


@pytest.mark.asyncio
async def test_read_policy_blocks_unknown_behavior() -> None:
    reg = registry(permission="read")
    tool = (await reg.list_all_tools())[0]

    # The read-only fixture is still explicitly allowed.
    assert (
        await reg.authorize_tool_call(
            tool,
            {"value": "safe"},
            [],
        )
    ) == canonical_arguments_sha256({"value": "safe"})


@pytest.mark.asyncio
async def test_write_policy_requires_exact_argument_approval() -> None:
    reg = registry(permission="write")
    tool = (await reg.list_all_tools())[0]
    arguments = {"value": "hello"}

    # The deterministic tool is explicitly read-only, so write policy can still
    # auto-execute it. This proves policy is an upper bound rather than a blanket
    # approval requirement for every tool.
    digest = await reg.authorize_tool_call(tool, arguments, [])
    assert digest == canonical_arguments_sha256(arguments)

    changed = {"value": "changed"}
    with pytest.raises(MCPApprovalRequired):
        # Simulate a future non-read-only tool by changing the normalized flag.
        tool.requires_approval = True
        tool.read_only = False
        await reg.authorize_tool_call(tool, changed, [])

    changed_digest = canonical_arguments_sha256(changed)
    grant = MCPApprovalGrant(
        tool=tool.qualified_name,
        arguments_sha256=changed_digest,
    )
    assert (
        await reg.authorize_tool_call(tool, changed, [grant])
    ) == changed_digest

    # A stale grant cannot authorize a modified payload.
    with pytest.raises(MCPApprovalRequired):
        await reg.authorize_tool_call(
            tool,
            {"value": "changed-again"},
            [grant],
        )


@pytest.mark.asyncio
async def test_client_server_summary_contains_no_credentials() -> None:
    reg = MCPRegistry(
        [
            MCPServerConfig(
                id="secret",
                transport="streamable_http",
                permission="read",
                url="http://127.0.0.1:9999/mcp",
                headers_env={"Authorization": "GITHUB_PERSONAL_ACCESS_TOKEN"},
            )
        ]
    )
    summary = reg.server_summaries()[0].model_dump()

    assert "GITHUB_PERSONAL_ACCESS_TOKEN" not in json.dumps(summary)
    assert "Authorization" not in json.dumps(summary)
    assert set(summary) == {"id", "transport", "enabled", "permission", "configured"}

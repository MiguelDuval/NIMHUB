import asyncio
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


async def discovered(reg: MCPRegistry) -> dict[str, object]:
    return {
        tool.name: tool
        for tool in await reg.list_all_tools()
    }


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
    tools = await discovered(reg)

    assert set(tools) == {"deterministic_echo", "protected_write"}
    echo = tools["deterministic_echo"]
    assert echo.qualified_name == "deterministic.deterministic_echo"
    assert echo.read_only is True
    assert echo.requires_approval is False

    protected = tools["protected_write"]
    assert protected.destructive is True
    assert protected.requires_approval is True

    result = await reg.call_tool(
        MCPToolCallRequest(
            tool=echo.model_name,
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
    echo = (await discovered(reg))["deterministic_echo"]

    with pytest.raises(ValueError, match="Invalid arguments"):
        await reg.call_tool(
            MCPToolCallRequest(
                tool=echo.model_name,
                arguments={"unexpected": "value"},
            )
        )


@pytest.mark.asyncio
async def test_read_policy_blocks_non_read_only_tool() -> None:
    reg = registry(permission="read")
    protected = (await discovered(reg))["protected_write"]

    with pytest.raises(MCPPolicyError):
        await reg.authorize_tool_call(
            protected,
            {"value": "blocked"},
            [],
        )


@pytest.mark.asyncio
async def test_write_policy_allows_explicit_read_only_tool() -> None:
    reg = registry(permission="write")
    echo = (await discovered(reg))["deterministic_echo"]
    arguments = {"value": "safe"}

    digest = await reg.authorize_tool_call(echo, arguments, [])
    assert digest == canonical_arguments_sha256(arguments)


@pytest.mark.asyncio
async def test_destructive_policy_requires_exact_argument_approval() -> None:
    reg = registry(permission="destructive")
    protected = (await discovered(reg))["protected_write"]
    arguments = {"value": "hello"}

    with pytest.raises(MCPApprovalRequired):
        await reg.authorize_tool_call(protected, arguments, [])

    digest = canonical_arguments_sha256(arguments)

    with pytest.raises(MCPApprovalRequired) as exc_info:
        await reg.authorize_tool_call(protected, arguments, [])
    approval_token = exc_info.value.approval_token

    forged = MCPApprovalGrant(
        approval_token="x" * 32,
        arguments_sha256=digest,
    )
    with pytest.raises(MCPApprovalRequired):
        await reg.authorize_tool_call(protected, arguments, [forged])

    grant = MCPApprovalGrant(
        approval_token=approval_token,
        arguments_sha256=digest,
    )
    assert await reg.authorize_tool_call(protected, arguments, [grant]) == digest

    result = await reg.call_tool(
        MCPToolCallRequest(
            tool=protected.qualified_name,
            arguments=arguments,
            approval_grants=[grant],
        )
    )
    assert result.is_error is False
    assert result.content[0]["text"] == "protected:hello"

    with pytest.raises(MCPApprovalRequired):
        await reg.call_tool(
            MCPToolCallRequest(
                tool=protected.qualified_name,
                arguments=arguments,
                approval_grants=[grant],
            )
        )

    with pytest.raises(MCPApprovalRequired):
        await reg.authorize_tool_call(
            protected,
            {"value": "changed"},
            [grant],
        )


@pytest.mark.asyncio
async def test_approval_token_cannot_be_consumed_twice_concurrently() -> None:
    reg = registry(permission="destructive")
    protected = (await discovered(reg))["protected_write"]
    arguments = {"value": "concurrent"}
    digest = canonical_arguments_sha256(arguments)

    with pytest.raises(MCPApprovalRequired) as exc_info:
        await reg.authorize_tool_call(protected, arguments, [])

    grant = MCPApprovalGrant(
        approval_token=exc_info.value.approval_token,
        arguments_sha256=digest,
    )

    results = await asyncio.gather(
        reg.call_tool(
            MCPToolCallRequest(
                tool=protected.qualified_name,
                arguments=arguments,
                approval_grants=[grant],
            )
        ),
        reg.call_tool(
            MCPToolCallRequest(
                tool=protected.qualified_name,
                arguments=arguments,
                approval_grants=[grant],
            )
        ),
        return_exceptions=True,
    )

    successes = [result for result in results if not isinstance(result, Exception)]
    failures = [result for result in results if isinstance(result, Exception)]

    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], (MCPApprovalRequired, MCPPolicyError))

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

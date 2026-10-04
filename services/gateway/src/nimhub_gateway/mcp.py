"""MCP client foundation for the NIM Hub gateway.

The gateway owns MCP configuration and credentials. The Android client only
sees sanitized server/tool metadata; transport credentials never cross the
gateway boundary.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx2
from mcp import Client, StdioServerParameters
from mcp.client.streamable_http import streamable_http_client
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class MCPConfigError(ValueError):
    """Raised when MCP server configuration is invalid or incomplete."""


class MCPServerConfig(BaseModel):
    """Gateway-side configuration for one MCP server.

    Secrets are referenced indirectly through environment-variable names.
    Values are never stored in this model or returned by the API.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    transport: Literal["streamable_http", "stdio"]
    enabled: bool = True
    permission: Literal["read", "write", "destructive"] = "read"

    url: str | None = None
    command: str | None = None
    args: list[str] = Field(default_factory=list)

    # Header name -> environment variable name.
    headers_env: dict[str, str] = Field(default_factory=dict)

    # Child-process environment name -> parent environment variable name.
    env_vars: dict[str, str] = Field(default_factory=dict)


class MCPServerSummary(BaseModel):
    """Safe server metadata suitable for returning to the Android client."""

    id: str
    transport: str
    enabled: bool
    permission: str
    configured: bool


class MCPToolDefinition(BaseModel):
    """Normalized MCP tool metadata used by the future agent/tool loop."""

    server_id: str
    name: str
    qualified_name: str
    description: str | None
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    read_only: bool | None
    destructive: bool | None
    idempotent: bool | None
    open_world: bool | None
    permission: Literal["read", "write", "destructive"]
    requires_approval: bool


def _annotation_value(annotations: Any, *names: str) -> bool | None:
    if annotations is None:
        return None

    if isinstance(annotations, dict):
        aliases = {
            "read_only_hint": ("read_only_hint", "readOnlyHint"),
            "destructive_hint": ("destructive_hint", "destructiveHint"),
            "idempotent_hint": ("idempotent_hint", "idempotentHint"),
            "open_world_hint": ("open_world_hint", "openWorldHint"),
        }
        for name in names:
            for key in aliases.get(name, (name,)):
                if key in annotations:
                    value = annotations[key]
                    return value if isinstance(value, bool) else None
        return None

    for name in names:
        value = getattr(annotations, name, None)
        if isinstance(value, bool):
            return value

    return None


def normalize_mcp_tool(
    server: MCPServerConfig,
    tool: Any,
) -> MCPToolDefinition:
    """Convert an SDK Tool object to a stable, JSON-safe gateway definition."""

    name = str(getattr(tool, "name", "")).strip()
    if not name:
        raise MCPConfigError(f"Server {server.id!r} returned a tool without a name")

    input_schema = getattr(tool, "input_schema", None)
    if input_schema is None:
        input_schema = getattr(tool, "inputSchema", None)
    if not isinstance(input_schema, dict):
        raise MCPConfigError(f"Tool {server.id}.{name} has no valid input schema")

    output_schema = getattr(tool, "output_schema", None)
    if output_schema is None:
        output_schema = getattr(tool, "outputSchema", None)
    if output_schema is not None and not isinstance(output_schema, dict):
        output_schema = None

    annotations = getattr(tool, "annotations", None)
    read_only = _annotation_value(annotations, "read_only_hint")
    destructive = _annotation_value(annotations, "destructive_hint")
    idempotent = _annotation_value(annotations, "idempotent_hint")
    open_world = _annotation_value(annotations, "open_world_hint")

    # Safe default: unknown tool behavior is approval-gated, even on a read
    # server. Only an explicitly read-only, non-destructive tool is automatic.
    requires_approval = (
        server.permission != "read"
        or read_only is not True
        or destructive is True
    )

    return MCPToolDefinition(
        server_id=server.id,
        name=name,
        qualified_name=f"{server.id}.{name}",
        description=getattr(tool, "description", None),
        input_schema=input_schema,
        output_schema=output_schema,
        read_only=read_only,
        destructive=destructive,
        idempotent=idempotent,
        open_world=open_world,
        permission=server.permission,
        requires_approval=requires_approval,
    )


def parse_mcp_servers(raw: str | None) -> list[MCPServerConfig]:
    """Parse the JSON server catalog from gateway settings.

    Accepted shape:
      [{"id": "github", ...}]
    or:
      {"servers": [{"id": "github", ...}]}
    """

    if not raw or not raw.strip():
        return []

    try:
        import json

        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MCPConfigError("MCP_SERVERS_JSON is not valid JSON") from exc

    if isinstance(value, dict):
        value = value.get("servers")

    if not isinstance(value, list):
        raise MCPConfigError("MCP_SERVERS_JSON must be a list or an object with a 'servers' list")

    try:
        servers = [MCPServerConfig.model_validate(item) for item in value]
    except ValidationError as exc:
        raise MCPConfigError(f"Invalid MCP server configuration: {exc}") from exc

    ids = [server.id for server in servers]
    if len(ids) != len(set(ids)):
        raise MCPConfigError("MCP server IDs must be unique")

    return servers


class MCPRegistry:
    """Gateway-side catalog and connector for configured MCP servers."""

    def __init__(self, servers: list[MCPServerConfig]):
        self._servers = {server.id: server for server in servers}

    @classmethod
    def from_json(cls, raw: str | None) -> "MCPRegistry":
        return cls(parse_mcp_servers(raw))

    def server_summaries(self) -> list[MCPServerSummary]:
        return [
            MCPServerSummary(
                id=server.id,
                transport=server.transport,
                enabled=server.enabled,
                permission=server.permission,
                configured=(
                    (server.transport == "streamable_http" and bool(server.url))
                    or (server.transport == "stdio" and bool(server.command))
                ),
            )
            for server in self._servers.values()
        ]

    def get_server(self, server_id: str) -> MCPServerConfig:
        server = self._servers.get(server_id)
        if server is None:
            raise MCPConfigError(f"Unknown MCP server: {server_id}")
        if not server.enabled:
            raise MCPConfigError(f"MCP server is disabled: {server_id}")
        return server

    @staticmethod
    def _resolve_env_refs(refs: dict[str, str], *, scope: str) -> dict[str, str]:
        resolved: dict[str, str] = {}
        for target_name, env_name in refs.items():
            value = __import__("os").environ.get(env_name)
            if not value:
                raise MCPConfigError(
                    f"Missing environment variable {env_name!r} required by MCP {scope}"
                )
            resolved[target_name] = value
        return resolved

    @asynccontextmanager
    async def _connect(self, server: MCPServerConfig):
        if server.transport == "stdio":
            if not server.command:
                raise MCPConfigError(f"MCP stdio server {server.id!r} requires 'command'")

            environment = self._resolve_env_refs(
                server.env_vars,
                scope=f"server {server.id!r}",
            )
            target = StdioServerParameters(
                command=server.command,
                args=server.args,
                env=environment or None,
            )
            async with Client(target) as client:
                yield client
            return

        if not server.url:
            raise MCPConfigError(
                f"MCP Streamable HTTP server {server.id!r} requires 'url'"
            )

        headers = self._resolve_env_refs(
            server.headers_env,
            scope=f"server {server.id!r}",
        )
        if not headers:
            async with Client(server.url) as client:
                yield client
            return

        async with httpx2.AsyncClient(headers=headers) as http_client:
            transport = streamable_http_client(server.url, http_client=http_client)
            async with Client(transport) as client:
                yield client

    async def list_tools(self, server_id: str) -> list[MCPToolDefinition]:
        server = self.get_server(server_id)
        async with self._connect(server) as client:
            response = await client.list_tools()
            return [normalize_mcp_tool(server, tool) for tool in response.tools]

    async def list_all_tools(self) -> list[MCPToolDefinition]:
        tools: list[MCPToolDefinition] = []
        for server in self._servers.values():
            if not server.enabled:
                continue
            tools.extend(await self.list_tools(server.id))
        return tools

"""Gateway-side MCP client, discovery and permission foundation.

The gateway is the MCP host. MCP server configuration and credentials stay on
the gateway; the Android client only receives sanitized metadata and approval
requests.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import time
import threading
from contextlib import asynccontextmanager
from os import environ
from typing import Any, Literal

import httpx2
from jsonschema import Draft202012Validator
from mcp import Client, StdioServerParameters
from mcp.client.streamable_http import streamable_http_client
from pydantic import BaseModel, ConfigDict, Field, ValidationError


MCPPermission = Literal["read", "write", "destructive"]


class MCPConfigError(ValueError):
    """Raised when MCP server configuration is invalid or incomplete."""


class MCPPolicyError(MCPConfigError):
    """Raised when a tool is incompatible with the configured server policy."""


class MCPApprovalRequired(MCPConfigError):
    """Raised when a tool call is valid but needs an explicit approval grant."""

    def __init__(self, tool: "MCPToolDefinition", arguments_sha256: str, approval_token: str) -> None:
        super().__init__(f"Approval required for MCP tool {tool.qualified_name}")
        self.tool = tool
        self.arguments_sha256 = arguments_sha256
        self.approval_token = approval_token


class MCPServerConfig(BaseModel):
    """Gateway-side configuration for one MCP server.

    Secrets are referenced indirectly through environment-variable names.
    Values are never stored in this model or returned by the API.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    transport: Literal["streamable_http", "stdio"]
    enabled: bool = True
    permission: MCPPermission = "read"

    url: str | None = None
    command: str | None = None
    args: list[str] = Field(default_factory=list)

    # HTTP header name -> parent environment variable name.
    headers_env: dict[str, str] = Field(default_factory=dict)

    # Child-process environment name -> parent environment variable name.
    env_vars: dict[str, str] = Field(default_factory=dict)


class MCPServerSummary(BaseModel):
    """Safe server metadata suitable for returning to the Android client."""

    id: str
    transport: str
    enabled: bool
    permission: MCPPermission
    configured: bool


class MCPToolDefinition(BaseModel):
    """Normalized internal representation of an MCP tool."""

    server_id: str
    name: str
    qualified_name: str
    model_name: str
    description: str | None
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    read_only: bool | None
    destructive: bool | None
    idempotent: bool | None
    open_world: bool | None
    permission: MCPPermission
    requires_approval: bool


class MCPToolSummary(BaseModel):
    """Sanitized tool metadata exposed to the Android client."""

    server_id: str
    name: str
    qualified_name: str
    model_name: str
    description: str | None
    read_only: bool | None
    destructive: bool | None
    idempotent: bool | None
    open_world: bool | None
    permission: MCPPermission
    requires_approval: bool


class MCPApprovalGrant(BaseModel):
    """Exact approval for one tool + canonical argument payload."""

    model_config = ConfigDict(extra="forbid")

    approval_token: str = Field(min_length=32, max_length=200)
    arguments_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class MCPToolCallRequest(BaseModel):
    """Gateway request for a direct MCP tool call."""

    model_config = ConfigDict(extra="forbid")

    tool: str = Field(min_length=1, max_length=200)
    arguments: dict[str, Any] = Field(default_factory=dict)
    approval_grants: list[MCPApprovalGrant] = Field(default_factory=list)


class MCPToolResult(BaseModel):
    """Normalized JSON-safe MCP tool result."""

    tool: str
    is_error: bool
    content: list[dict[str, Any]]
    structured_content: Any | None = None
    arguments_sha256: str


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


def _model_function_name(server_id: str, tool_name: str) -> str:
    """Create a stable OpenAI-compatible function name with a reverse mapping."""
    raw = f"{server_id}__{tool_name}"
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", raw)
    if len(safe) <= 64:
        return safe

    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]
    return f"{safe[:55]}_{digest}"


def canonical_arguments_sha256(arguments: dict[str, Any]) -> str:
    """Hash canonical JSON so approvals bind to the exact call arguments."""
    try:
        encoded = json.dumps(
            arguments,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise MCPConfigError("MCP tool arguments must be JSON serializable") from exc
    return hashlib.sha256(encoded).hexdigest()


def normalize_mcp_tool(server: MCPServerConfig, tool: Any) -> MCPToolDefinition:
    """Convert an SDK Tool object to stable JSON-safe gateway metadata."""

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

    # Server permission is a hard upper bound. Tool annotations decide the
    # minimum permission needed by this specific operation:
    # read-only -> read, non-read-only/unknown -> write, destructive -> destructive.
    required_permission: MCPPermission
    if destructive is True:
        required_permission = "destructive"
    elif read_only is True:
        required_permission = "read"
    else:
        required_permission = "write"

    requires_approval = required_permission != "read"

    return MCPToolDefinition(
        server_id=server.id,
        name=name,
        qualified_name=f"{server.id}.{name}",
        model_name=_model_function_name(server.id, name),
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


def to_client_summary(tool: MCPToolDefinition) -> MCPToolSummary:
    """Strip schemas and all server credential/configuration details."""
    return MCPToolSummary(
        server_id=tool.server_id,
        name=tool.name,
        qualified_name=tool.qualified_name,
        model_name=tool.model_name,
        description=tool.description,
        read_only=tool.read_only,
        destructive=tool.destructive,
        idempotent=tool.idempotent,
        open_world=tool.open_world,
        permission=tool.permission,
        requires_approval=tool.requires_approval,
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
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MCPConfigError("MCP_SERVERS_JSON is not valid JSON") from exc

    if isinstance(value, dict):
        value = value.get("servers")

    if not isinstance(value, list):
        raise MCPConfigError(
            "MCP_SERVERS_JSON must be a list or an object with a 'servers' list"
        )

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
        self._pending_approvals: dict[str, tuple[str, str, float]] = {}
        self._approval_lock = threading.Lock()
        self._approval_ttl_seconds = 600.0

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
            value = environ.get(env_name)
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
                raise MCPConfigError(
                    f"MCP stdio server {server.id!r} requires 'command'"
                )

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

        async with httpx2.AsyncClient(
            headers=headers,
            timeout=httpx2.Timeout(30.0, read=300.0),
        ) as http_client:
            transport = streamable_http_client(
                server.url,
                http_client=http_client,
            )
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

    async def resolve_tool(self, tool_ref: str) -> MCPToolDefinition:
        """Resolve either model function name or server.tool qualified name."""
        tools = await self.list_all_tools()
        for tool in tools:
            if tool_ref in {tool.model_name, tool.qualified_name}:
                return tool
        raise MCPConfigError(f"Unknown MCP tool: {tool_ref}")

    @staticmethod
    def _validate_arguments(tool: MCPToolDefinition, arguments: dict[str, Any]) -> None:
        try:
            Draft202012Validator.check_schema(tool.input_schema)
            validator = Draft202012Validator(tool.input_schema)
            errors = sorted(
                validator.iter_errors(arguments),
                key=lambda error: list(error.path),
            )
        except Exception as exc:
            raise MCPConfigError(
                f"Tool {tool.qualified_name} has an invalid input schema"
            ) from exc

        if errors:
            details = "; ".join(error.message for error in errors[:5])
            raise MCPConfigError(
                f"Invalid arguments for {tool.qualified_name}: {details}"
            )

    def _is_approved(
        self,
        tool: MCPToolDefinition,
        arguments_sha256: str,
        grants: list[MCPApprovalGrant],
    ) -> bool:
        now = time.monotonic()
        with self._approval_lock:
            for token, (_, _, expires_at) in list(self._pending_approvals.items()):
                if expires_at <= now:
                    self._pending_approvals.pop(token, None)

            for grant in grants:
                pending = self._pending_approvals.get(grant.approval_token)
                if pending is None:
                    continue
                pending_tool, pending_hash, expires_at = pending
                if (
                    expires_at > now
                    and pending_tool in {tool.model_name, tool.qualified_name}
                    and pending_hash == arguments_sha256
                    and grant.arguments_sha256 == arguments_sha256
                ):
                    return True
        return False

    def _consume_approval(
        self,
        tool: MCPToolDefinition,
        arguments_sha256: str,
        grants: list[MCPApprovalGrant],
    ) -> bool:
        """Atomically consume one matching approval grant exactly once."""
        now = time.monotonic()
        with self._approval_lock:
            for token, (_, _, expires_at) in list(self._pending_approvals.items()):
                if expires_at <= now:
                    self._pending_approvals.pop(token, None)

            for grant in grants:
                pending = self._pending_approvals.get(grant.approval_token)
                if pending is None:
                    continue
                pending_tool, pending_hash, expires_at = pending
                if (
                    expires_at > now
                    and pending_tool in {tool.model_name, tool.qualified_name}
                    and pending_hash == arguments_sha256
                    and grant.arguments_sha256 == arguments_sha256
                ):
                    self._pending_approvals.pop(grant.approval_token, None)
                    return True
        return False

    def _issue_approval_token(
        self,
        tool: MCPToolDefinition,
        arguments_sha256: str,
    ) -> str:
        token = secrets.token_urlsafe(32)
        self._pending_approvals[token] = (
            tool.qualified_name,
            arguments_sha256,
            time.monotonic() + self._approval_ttl_seconds,
        )
        return token

    def _enforce_policy(
        self,
        tool: MCPToolDefinition,
        *,
        arguments_sha256: str,
        grants: list[MCPApprovalGrant],
    ) -> None:
        if tool.permission == "read" and tool.read_only is not True:
            raise MCPPolicyError(
                f"Tool {tool.qualified_name} is not explicitly read-only; "
                "read-only MCP server policy blocks execution"
            )

        if tool.permission == "write" and tool.destructive is True:
            raise MCPPolicyError(
                f"Tool {tool.qualified_name} requires destructive MCP permission"
            )

        if tool.requires_approval and not self._is_approved(
            tool,
            arguments_sha256,
            grants,
        ):
            approval_token = self._issue_approval_token(tool, arguments_sha256)
            raise MCPApprovalRequired(
                tool,
                arguments_sha256,
                approval_token,
            )

    @staticmethod
    def _serialize_content(content: Any) -> dict[str, Any]:
        if isinstance(content, dict):
            return content
        model_dump = getattr(content, "model_dump", None)
        if callable(model_dump):
            return model_dump(by_alias=True, exclude_none=True)
        return {"type": "unknown", "value": str(content)}

    async def authorize_tool_call(
        self,
        tool: MCPToolDefinition,
        arguments: dict[str, Any],
        grants: list[MCPApprovalGrant],
    ) -> str:
        """Validate and authorize a tool call without executing it."""
        self._validate_arguments(tool, arguments)
        arguments_sha256 = canonical_arguments_sha256(arguments)
        self._enforce_policy(
            tool,
            arguments_sha256=arguments_sha256,
            grants=grants,
        )
        return arguments_sha256

    async def call_tool(
        self,
        request: MCPToolCallRequest,
    ) -> MCPToolResult:
        tool = await self.resolve_tool(request.tool)
        arguments_sha256 = await self.authorize_tool_call(
            tool,
            request.arguments,
            request.approval_grants,
        )

        if tool.requires_approval:
            # Re-check and consume while holding the approval lock so two
            # concurrent requests cannot both execute the same approved call.
            if not self._consume_approval(
                tool,
                arguments_sha256,
                request.approval_grants,
            ):
                raise MCPPolicyError(
                    f"Approval grant for {tool.qualified_name} was already consumed or expired"
                )

        async with self._connect(self.get_server(tool.server_id)) as client:
            result = await client.call_tool(tool.name, request.arguments)

        content = [self._serialize_content(item) for item in result.content]
        structured_content = getattr(result, "structured_content", None)
        is_error = bool(getattr(result, "is_error", False))

        return MCPToolResult(
            tool=tool.qualified_name,
            is_error=is_error,
            content=content,
            structured_content=structured_content,
            arguments_sha256=arguments_sha256,
        )

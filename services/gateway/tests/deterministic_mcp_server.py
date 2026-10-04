"""Deterministic MCP server used only by gateway tests.

It uses the official MCP Python SDK and stdio transport so the tests exercise
the same external-process boundary used by local MCP servers.
"""

from mcp.server import MCPServer
from mcp.types import ToolAnnotations

mcp = MCPServer("NIM Hub Deterministic Test", version="0.1.0")


@mcp.tool(
    description="Deterministically echo a value for integration tests.",
    annotations=ToolAnnotations(
        read_only_hint=True,
        idempotent_hint=True,
        open_world_hint=False,
    ),
)
def deterministic_echo(value: str) -> str:
    return f"deterministic:{value}"


@mcp.tool(
    description="A protected deterministic write used to verify approval handling.",
    annotations=ToolAnnotations(
        read_only_hint=False,
        destructive_hint=True,
        idempotent_hint=False,
        open_world_hint=False,
    ),
)
def protected_write(value: str) -> str:
    return f"protected:{value}"


if __name__ == "__main__":
    mcp.run()

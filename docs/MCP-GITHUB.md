# MCP and GitHub Integration

## MCP
Use the official MCP ecosystem instead of inventing a custom tool protocol.

References:
- https://modelcontextprotocol.io/
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/modelcontextprotocol/python-sdk

The current official SDK line is v2 around the 2026-07-28 protocol specification. Verify exact APIs against installed package versions before coding.

## GitHub
Preferred integration: GitHub's official MCP Server: https://github.com/github/github-mcp-server

It exposes repository/code, issues/PRs and Actions-related capabilities among other toolsets.

## Staged permissions
1. repository metadata/read/search;
2. issues and PRs read;
3. Actions diagnostics read;
4. create branch/file/comment;
5. push/create PR/merge/delete only behind approval.

## Authentication
Keep GitHub credentials on the gateway side. Never put personal access tokens in the client bundle or localStorage.

## MCP transport
Start with Streamable HTTP and stdio using official SDKs. Store server configuration separately from credentials.

## Runtime discovery
The agent should enumerate available tools at runtime and bind only the tools relevant to the current task.

## NIM Hub gateway configuration

MCP server definitions live in the gateway's `MCP_SERVERS_JSON` setting. The
JSON contains transport and permission policy, but credentials are referenced
only by environment-variable name.

For the official GitHub MCP Server, start with a read-only stdio profile:

```json
{
  "servers": [
    {
      "id": "github",
      "transport": "stdio",
      "permission": "read",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "-e",
        "GITHUB_TOOLSETS",
        "ghcr.io/github/github-mcp-server",
        "--read-only"
      ],
      "env_vars": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN",
        "GITHUB_TOOLSETS": "GITHUB_TOOLSETS"
      }
    }
  ]
}
```

Then keep the actual values only in the gateway environment:

```text
GITHUB_PERSONAL_ACCESS_TOKEN=<secret>
GITHUB_TOOLSETS=context,repos
MCP_SERVERS_JSON=<the JSON above>
```

Progress the server in stages rather than enabling the full GitHub surface at
once:

1. `context,repos` + `--read-only` for repository metadata/read/search.
2. Add `issues,pull_requests` while keeping `--read-only`.
3. Add `actions` for Actions diagnostics while keeping `--read-only`.
4. Remove `--read-only` and set gateway permission to `write`. Explicitly
   read-only tools may execute; write tools require an exact approval grant.
   Destructive tools are blocked at this policy level.
5. Set gateway permission to `destructive` only when destructive GitHub
   operations are intentionally exposed. The gateway still requires an exact
   approval grant for every such call.

The official GitHub MCP Server currently supports toolset and individual-tool
allow-lists plus a strict read-only mode; read-only mode disables write tools
even when they are otherwise requested. Tool names and the available catalog
are upstream-controlled, so NIM Hub should discover them at runtime rather
than hard-code a tool catalog.

## Gateway API

- `GET /api/mcp/servers` — safe server status metadata.
- `GET /api/mcp/tools` — runtime-discovered, sanitized tool metadata.
- `POST /api/mcp/call` — one validated MCP call through the permission boundary.
- `POST /api/agent` — generic model/tool loop; use `stream: true` for SSE.

Approval grants are bound to the canonical JSON argument hash. Changing even
one argument invalidates the grant, so the client cannot silently approve one
operation and execute another.

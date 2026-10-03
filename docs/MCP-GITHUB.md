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
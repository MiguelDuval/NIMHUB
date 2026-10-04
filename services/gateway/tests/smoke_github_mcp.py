"""End-to-end read-only GitHub MCP smoke through the NIM Hub gateway.

The gateway process and official GitHub MCP server are started by CI. This
script deliberately discovers the tool model name from /api/mcp/tools before
calling it, so the client-facing function name remains runtime-derived.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


BASE_URL = os.environ.get("NIMHUB_GATEWAY_URL", "http://127.0.0.1:8787").rstrip("/")
OWNER = os.environ.get("GITHUB_MCP_SMOKE_OWNER", "MiguelDuval")
REPO = os.environ.get("GITHUB_MCP_SMOKE_REPO", "NIMHUB")
REF = os.environ.get(
    "GITHUB_MCP_SMOKE_REF",
    "refs/heads/feat/phase1-core-workstation",
)
TARGET_TOOL = os.environ.get("GITHUB_MCP_SMOKE_TOOL", "get_file_contents")


def request_json(path: str, *, method: str = "GET", body: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Gateway returned HTTP {exc.code} for {path}: {detail}") from exc


def main() -> None:
    servers = request_json("/api/mcp/servers")
    github_server = next(
        (server for server in servers.get("servers", []) if server.get("id") == "github"),
        None,
    )
    if github_server is None:
        raise SystemExit("GitHub MCP server was not reported by the gateway")
    if github_server.get("permission") != "read":
        raise SystemExit(f"Expected GitHub MCP server permission=read, got {github_server!r}")
    if not github_server.get("enabled") or not github_server.get("configured"):
        raise SystemExit(f"GitHub MCP server is not enabled/configured: {github_server!r}")

    discovered = request_json("/api/mcp/tools")
    tools = discovered.get("tools", [])
    tool = next((item for item in tools if item.get("name") == TARGET_TOOL), None)
    if tool is None:
        names = ", ".join(sorted(str(item.get("name")) for item in tools))
        raise SystemExit(f"Expected discovered tool {TARGET_TOOL!r}; got: {names}")

    if tool.get("read_only") is not True:
        raise SystemExit(f"Smoke target is not explicitly read-only: {tool!r}")
    if tool.get("permission") != "read" or tool.get("requires_approval") is not False:
        raise SystemExit(f"Gateway did not classify the target as safe read-only: {tool!r}")

    result = request_json(
        "/api/mcp/call",
        method="POST",
        body={
            "tool": tool["model_name"],
            "arguments": {
                "owner": OWNER,
                "repo": REPO,
                "path": "README.md",
                "ref": REF,
            },
        },
    )

    if result.get("is_error"):
        raise SystemExit(f"GitHub MCP tool returned an MCP error: {result!r}")

    def collect_text(value: object) -> list[str]:
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            text_values: list[str] = []
            for item in value:
                text_values.extend(collect_text(item))
            return text_values
        if isinstance(value, dict):
            text_values: list[str] = []
            if isinstance(value.get("text"), str):
                text_values.append(value["text"])
            if "resource" in value:
                text_values.extend(collect_text(value["resource"]))
            if "content" in value:
                text_values.extend(collect_text(value["content"]))
            return text_values
        return []

    text_parts = collect_text(result.get("content", []))
    if "NIM Hub" not in "".join(text_parts):
        raise SystemExit(
            "GitHub MCP smoke returned unexpected README content: "
            + json.dumps(result, ensure_ascii=False)[:2000]
        )

    print(
        json.dumps(
            {
                "ok": True,
                "server": github_server["id"],
                "discovered_tool": tool["name"],
                "model_tool": tool["model_name"],
                "read_only": tool["read_only"],
                "permission": tool["permission"],
                "target": f"{OWNER}/{REPO}@{REF}",
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

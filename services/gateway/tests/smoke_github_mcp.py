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


class FakeNIM:
    def __init__(self, tool_name: str, owner: str, repo: str, ref: str) -> None:
        self.tool_name = tool_name
        self.owner = owner
        self.repo = repo
        self.ref = ref
        self.calls: list[dict] = []

    async def chat(self, payload: dict) -> dict:
        self.calls.append(payload)
        if len(self.calls) == 1:
            return {
                "id": "smoke-chat-1",
                "object": "chat.completion",
                "created": 1,
                "model": "smoke-model",
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": "smoke-call-1",
                            "type": "function",
                            "function": {
                                "name": self.tool_name,
                                "arguments": json.dumps({
                                    "owner": self.owner,
                                    "repo": self.repo,
                                    "path": "README.md",
                                    "ref": self.ref,
                                }),
                            },
                        }],
                    },
                    "finish_reason": "tool_calls",
                }],
            }

        return {
            "id": "smoke-chat-2",
            "object": "chat.completion",
            "created": 2,
            "model": "smoke-model",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "GitHub MCP read completed.",
                },
                "finish_reason": "stop",
            }],
        }

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

    # Exercise the real AgentRuntime against the same discovered GitHub MCP
    # server. FakeNIM only replaces the model provider; MCP remains real.
    from nimhub_gateway.agent import AgentRunRequest, AgentRuntime
    from nimhub_gateway.main import mcp_registry

    fake_nim = FakeNIM(tool["model_name"], OWNER, REPO, REF)
    agent_result = __import__("asyncio").run(
        AgentRuntime(fake_nim, mcp_registry).run(
            AgentRunRequest(
                model="smoke-model",
                messages=[{"role": "user", "content": "Read the NIM Hub README."}],
            )
        )
    )
    if agent_result.status != "completed":
        raise SystemExit(f"Agent/MCP smoke did not complete: {agent_result.model_dump()!r}")

    agent_tool_messages = [
        message
        for message in agent_result.messages
        if message.get("role") == "tool"
    ]
    if not agent_tool_messages:
        raise SystemExit("Agent/MCP smoke produced no tool result message")
    if "NIM Hub" not in json.dumps(agent_tool_messages, ensure_ascii=False):
        raise SystemExit("Agent/MCP smoke did not receive expected README content")
    if len(fake_nim.calls) != 2:
        raise SystemExit(f"Expected two Agent model turns, got {len(fake_nim.calls)}")

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
                "agent_runtime": {
                    "status": agent_result.status,
                    "model_turns": len(fake_nim.calls),
                    "tool_results": len(agent_tool_messages),
                },
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

# NIM Hub — Agent Loop

Build the Android workstation in small verified slices without requiring routine user testing.

Observe -> plan -> implement -> test -> inspect -> fix -> document -> commit -> push -> continue.

The only product target is Android APK. Do not spend implementation effort on standalone web, desktop or iOS deliverables.

Use existing SDKs/protocols. Verify current NVIDIA and Capacitor APIs against upstream docs.

After each coherent slice run static checks, tests and Android build verification as applicable. Fix failures before committing.

Never place credentials in source or APK. CI secrets may be used only in server-side/smoke-test steps.

Ask only for missing credentials, destructive external actions or genuinely unresolved material product decisions.

## Current MCP loop contract

1. Discover MCP tools at runtime through the gateway.
2. Convert each tool to an OpenAI-compatible function definition for the selected model.
3. For every model tool call, parse JSON arguments and validate them against the discovered JSON Schema.
4. Enforce gateway policy before execution. Unknown/non-read-only behavior is never silently trusted.
5. Write operations require an exact approval grant; destructive operations also require the server permission level to explicitly expose them.
6. Execute multiple calls from one model turn without short-circuiting the conversation on a single tool error.
7. Append each tool result/error as a normal `tool` message and give the model another turn.
8. Stop on a normal assistant response, an approval request, or the bounded maximum turn count.
9. Streaming emits content/tool/approval events over SSE while preserving the same state machine.

Approval grants are SHA-256 hashes of canonical JSON arguments plus the exact tool identifier. A changed argument payload therefore cannot reuse an earlier approval.

The client receives only sanitized server/tool metadata and approval information. Tool schemas and MCP credentials remain gateway-side.

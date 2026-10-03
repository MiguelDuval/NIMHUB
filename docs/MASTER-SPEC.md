# NIM Hub — Master Specification

## Product
NIM Hub is a personal-use, mobile-first AI workstation built around NVIDIA NIM and adjacent NVIDIA AI services. Commercial SaaS concerns are out of scope for now.

## Core modes
- Chat: multi-turn, streaming, Markdown/code, attachments, cancel, retry, persistence.
- Vision: image attachments and capability-aware model selection.
- Image: generation and supported editing; results become artifacts.
- Video: text/image-to-video where supported; always modelled as an asynchronous job.
- Voice: push-to-talk, hands-free mode, ASR, LLM/agent, TTS, interruption/cancel.
- Agent: tool calling, tool discovery, MCP, multi-step execution, visible activity, cancellation and permissions.
- GitHub: repository/code reading, issues/PRs, Actions diagnostics and controlled writes through the official GitHub MCP Server.
- Files/artifacts: attachments, generated media, export/save, metadata.

## Architecture
Use: responsive React/TypeScript PWA -> personal FastAPI gateway -> provider adapters -> NVIDIA NIM/MCP/external tools.

The gateway is the trust boundary for provider credentials, validation, streaming normalization, jobs, persistence and tool permissions. Long-lived NVIDIA/GitHub credentials must never ship in static client JavaScript.

## Provider model
Use small interfaces for Chat, Image, Video, ASR and TTS. NVIDIA NIM is the first/default provider. Capabilities are data; do not force every model to support every modality.

## Model registry
Record at least model ID, provider, endpoint family, accepted modalities, produced modalities, reasoning/tool flags and discovery timestamp. Use `/v1/models` where appropriate, with separate endpoint-specific configuration for visual/speech families.

## Jobs
Common state: `queued -> running -> completed | failed | cancelled`. Include stable ID, timestamps, progress when available, errors and artifact references.

## Agent safety
Classify tools as read-only, reversible write, or sensitive/destructive write. Sensitive operations such as push, merge, delete and credential changes require an approval boundary.

## Memory and storage
Start with conversation history and lightweight memory. Use embedded SQLite or similarly small persistence. Do not add a vector DB without a demonstrated retrieval need.

## Mobile
Responsive PWA first. Android packaging with Capacitor is deferred until the core workstation is stable.

## Non-goals
No SaaS billing, multi-tenant RBAC, Kubernetes, horizontal cloud scaling, custom model hosting, or a custom replacement for MCP.

## v0.1 definition of done
A local user can configure an NVIDIA key outside source control, discover models, stream chat, attach an image to a compatible model, receive clean unsupported-capability errors, use the responsive client on Android, and build through GitHub Actions.

## v0.2
ASR/TTS voice, image generation/editing, basic agent loop, MCP and GitHub MCP integration.

## v0.3
Video jobs, artifact library, persistent agent runs, approvals, stronger PWA shell and optional Capacitor package.

## Quality bar
Reliability beats breadth. A feature is incomplete until normal behavior, common failures, cancellation where relevant, tests and documentation are addressed.
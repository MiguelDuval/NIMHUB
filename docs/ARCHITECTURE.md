# NIM Hub — Architecture

## Runtime
Android APK -> native NVIDIA NIM HTTP for core chat/model discovery. The APK can optionally connect to a Personal Gateway (FastAPI) for Agent runtime, MCP, GitHub and server-side jobs/artifacts.

## Repository target
`apps/client` — React + TypeScript + Vite PWA.
`services/gateway` — FastAPI trust boundary and orchestration.
`packages/contracts` — shared types if they become useful.
`docs` — project contracts and references.
`.github` — CI, builds and automation.

## Client responsibilities
Presentation, local UI state, conversation rendering, capture of microphone/camera/files, artifact preview, approvals and connection state.

## Gateway responsibilities
Optional secret injection, validation, provider routing, streaming normalization, agent loop, MCP, jobs, persistence and structured errors. Runtime NVIDIA requests from Android may carry the device-held NVIDIA key in a transient request header; the gateway must not persist or log it.

## Provider adapters
Prefer narrow interfaces: ChatProvider, ImageProvider, VideoProvider, SpeechToTextProvider, TextToSpeechProvider.

## Streaming
SSE is sufficient for initial chat streaming. WebSockets are optional for bidirectional voice or job telemetry.

## Error envelope
Use `code`, `message`, `provider`, `retryable`, and `request/job ID`. Never leak credentials or raw authorization headers.

## Model routing
Capabilities are explicit data. The UI must not present every model as compatible with every modality.

## Agent runtime
Start with a small deterministic tool-calling loop. NeMo Agent Toolkit is an approved optional integration/reference path, not a mandatory MVP dependency.

## MCP
Gateway-side MCP host/client. Start with Streamable HTTP and stdio using official SDKs. Keep server definitions separate from credentials.

## Android packaging
Keep Capacitor as the Android shell. The gateway remains a separate optional service and is not required for basic NVIDIA chat/model usage.
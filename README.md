# NIM Hub

Personal, NVIDIA-first AI workstation for Android/mobile and desktop use.

NIM Hub is intentionally a **personal-use project first**. It is not designed around a commercial SaaS model, multi-tenant billing, or vendor lock-in. NVIDIA NIM is the primary inference provider, while the architecture keeps provider adapters replaceable so the project can survive API/catalog changes.

## Mission

Build one lightweight client/workstation that unifies:

- NVIDIA NIM chat, reasoning and vision models
- image generation and editing
- video generation
- speech-to-text and text-to-speech
- hands-free voice interaction
- agentic tool use
- MCP servers
- GitHub work
- files, artifacts and project workspaces
- persistent conversations and lightweight memory

The first delivery target is a fast, maintainable personal workstation. Feature breadth must never outrun reliability.

## Current implementation strategy

- **Client:** React + TypeScript + Vite, designed as a responsive PWA first.
- **Gateway:** Python + FastAPI for secret handling, NVIDIA proxying, jobs and agent/tool orchestration.
- **NVIDIA:** NIM APIs as the primary model provider.
- **Agent layer:** provider/model-agnostic tool-calling core first; NVIDIA NeMo Agent Toolkit is a supported reference/integration path, not a mandatory dependency for the MVP.
- **Tools:** MCP first; direct adapters only where they materially simplify the personal workflow.
- **GitHub:** official GitHub MCP Server is the preferred GitHub tool surface.
- **Android:** PWA/mobile-first delivery first; Capacitor packaging is planned only after the core client is stable.

## Working rules

1. Never commit secrets.
2. Never hard-code a single NVIDIA model as the architecture's identity.
3. Discover or configure model capabilities instead of assuming every model supports every modality.
4. Keep NIM-specific code behind adapters.
5. Prefer small, reversible changes.
6. Every pushed change must pass CI.
7. Do not break main; feature work should use branches.
8. Do not add infrastructure merely for theoretical future scale.
9. Prefer existing open-source components over reimplementing mature protocols.
10. The agent should verify its own work with local tests/builds before committing.

## Documentation

Start with AGENTS.md, then:

- docs/MASTER-SPEC.md
- docs/ARCHITECTURE.md
- docs/NVIDIA-NIM.md
- docs/AGENT-LOOP.md
- docs/MCP-GITHUB.md
- EGIT.md
- docs/BUILD.md
- docs/SECURITY.md
- docs/ROADMAP.md
- docs/DECISIONS.md

## Development

Copy .env.example to .env and add credentials locally.

The repository is intentionally bootstrapped with a minimal vertical slice. The long-running implementation agent should expand it according to docs/MASTER-SPEC.md without redesigning the project from scratch.

## Important external references

- NVIDIA Build: https://build.nvidia.com/models
- NVIDIA NIM LLM/VLM API: https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
- NVIDIA Visual GenAI API: https://docs.nvidia.com/nim/visual-genai/latest/api/index.html
- NVIDIA Speech NIM: https://docs.nvidia.com/nim/speech/latest/
- NVIDIA NeMo Agent Toolkit: https://github.com/NVIDIA/NeMo-Agent-Toolkit
- MCP specification and SDKs: https://modelcontextprotocol.io/
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- GitHub MCP Server: https://github.com/github/github-mcp-server
- Open WebUI (reference project): https://github.com/open-webui/open-webui

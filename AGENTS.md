# NIM Hub — Agent Instructions

## Mission
NIM Hub is a personal-use, NVIDIA-first AI workstation. Build for one technically sophisticated user first: fast, reliable, understandable, and easy to extend. Do not optimize for SaaS, billing, multi-tenancy, or enterprise scale.

## Source of truth
Read AGENTS.md, then docs/MASTER-SPEC.md, docs/ARCHITECTURE.md, docs/NVIDIA-NIM.md, docs/AGENT-LOOP.md, EGIT.md, docs/SECURITY.md and docs/BUILD.md before substantial architectural changes. Verify volatile API details against upstream documentation.

## Non-negotiable rules
- Keep main safe. Do not reset, rebase, force-push, or rewrite history unless explicitly requested.
- Use feature branches for substantial changes.
- Never commit API keys, OAuth tokens, cookies, certificates, or secret-bearing local files.
- NIM is the primary provider, but never hard-wire the product to one model ID.
- Keep provider-specific behavior behind small adapters.
- Prefer mature open-source SDKs/protocols over custom replacements.
- Do not add heavy infrastructure before a concrete feature requires it.
- Verify changes locally before commit.
- Keep commits coherent and reversible.
- Do not ask the user to run routine tests or diagnostics that the agent can run itself.
- Avoid repetitive progress reports; work autonomously, verify, commit and push when authenticated.

## Default work loop
Observe -> plan -> implement -> test -> inspect -> fix -> document -> commit -> push -> continue.

## Product priority
1. Chat/reasoning/vision.
2. Model discovery and capability routing.
3. ASR + TTS voice mode.
4. Image generation/editing.
5. Agent + MCP.
6. GitHub tools.
7. Video and long-running jobs.
8. Mobile packaging/polish.

## UX principle
NIM Hub should feel like one workstation, not separate provider pages. Users should switch modality/model without learning transport details.

## API discipline
NVIDIA catalog, endpoints, capabilities, quotas and SDKs change. Do not invent facts or freeze volatile information into business logic.

## Blockers
Ask only when an external secret is genuinely required and unavailable, a destructive/irreversible action is required, or a material product decision cannot be resolved from the specification.
# NIM Hub — Roadmap

## Phase 0 — Bootstrap
- project rules and agent contract
- responsive PWA shell
- FastAPI gateway
- NIM model discovery
- streamed chat vertical slice
- CI/build artifacts

## Phase 1 — Core workstation
- conversation persistence
- capability-aware model registry
- image attachments
- cancellation/retry
- stable error envelope
- artifact abstraction

## Phase 2 — Voice and visual
- ASR
- TTS
- push-to-talk
- hands-free voice mode
- image generation/editing

### Phase 2 implementation status
- ✅ Separate provider profiles for Image, Video, ASR and TTS
- ✅ Optional dedicated NVIDIA API key per media family
- ✅ Chat-key fallback for media families
- ✅ Native Android multipart transport for speech and image editing
- ✅ Image generation/editing Media Studio
- ✅ Push-to-talk ASR → Chat → TTS workflow
- ✅ Video generation Media Studio vertical slice
- ✅ Generated media stored as local artifacts
- ✅ Target-specific media model selection and endpoint diagnostics
- ✅ Native Android export of image/video/audio artifacts
- ⏳ Hands-free interruption / continuous conversation

## Phase 3 — Agent
- native tool loop
- MCP client
- approval UI
- GitHub MCP Server
- filesystem/workspace tools

## Phase 4 — Long-running media
- ✅ video jobs
- ✅ video job state machine / progress reporting
- ✅ artifact library
- ✅ Android MediaStore export
- ⏳ background agent runs

## Phase 5 — Mobile packaging
- polished PWA install flow
- ✅ Capacitor Android package
- ✅ secure Android credential storage

## Deferred
No SaaS billing, enterprise administration, Kubernetes or cloud autoscaling unless the product direction explicitly changes.

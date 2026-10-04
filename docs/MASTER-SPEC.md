# NIM Hub — Master Specification

## Product target
NIM Hub is a personal AI workstation whose only product target is Android.

React/TypeScript/Vite is the UI technology inside the Android app. Standalone browser, desktop and iOS products are not part of the plan.

## Core modes
Chat, reasoning, vision, image generation/editing, video generation, ASR, TTS, voice conversation, agent/tool calling, MCP, GitHub, files/artifacts, persistent conversations and lightweight memory.

## Runtime
Core Android runtime: APK (Capacitor + React/TypeScript) -> NVIDIA NIM over Capacitor native HTTP. Optional advanced runtime: APK -> personal FastAPI gateway -> Agent/MCP/GitHub/server-side providers and tools.

Gateway responsibilities: optional server-side credential storage, provider routing, validation, streaming normalization, jobs, persistence, agent tools and permissions. Android may instead hold the NVIDIA key in Keystore-backed secure storage for direct core NIM access.

## Model registry
Record model ID, provider, endpoint family, accepted/produced modalities, reasoning/tool flags and discovery timestamp. Prefer live discovery over hard-coded catalog lists.

## Jobs
Use queued -> running -> completed | failed | cancelled for long-running generation.

## Security
Never commit secrets. Never package provider credentials inside the APK or place them in browser storage. Long-lived Android credentials must use Keystore-backed secure app storage. Sensitive tool writes require approval.

## Non-goals
Standalone web product, desktop product, iOS product, SaaS billing, multi-tenant enterprise infrastructure, Kubernetes, cloud autoscaling, custom model hosting and custom replacements for MCP/GitHub APIs.

## v0.1
An Android build can configure an NVIDIA key inside the app without source control or a local gateway, securely store it on-device, discover models, send chat, attach an image to a compatible model, display clean errors, and produce an installable APK in GitHub Actions.

## v0.2
ASR/TTS voice, image generation/editing, basic agent loop, MCP and GitHub MCP.

## v0.3
Video jobs, artifact library, persistent agent runs, approval UI and polished Android packaging.

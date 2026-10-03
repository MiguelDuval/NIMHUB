# NIM Hub — Architecture Decisions

## ADR-001: NIM-first, not NIM-only
NVIDIA NIM is the primary provider, but provider interfaces remain replaceable because hosted APIs and catalogs can change.

## ADR-002: Gateway before direct browser inference
Provider credentials and sensitive tools live behind the gateway to avoid exposing long-lived secrets and to centralize routing/validation.

## ADR-003: PWA before native Android
Prove the workstation on a responsive PWA first. Add Capacitor after the core workflow is reliable.

## ADR-004: MCP instead of custom tool RPC
Use the official MCP protocol and SDKs to connect tools and services.

## ADR-005: Small agent loop first
Start with a deterministic native tool-calling loop. Add NeMo Agent Toolkit where it demonstrably reduces complexity or improves observability/evaluation.

## ADR-006: No vector DB initially
Conversation history and lightweight memory are enough until retrieval is a demonstrated need.

## ADR-007: Video is a job
Model video generation as an asynchronous job and artifact flow from the beginning.
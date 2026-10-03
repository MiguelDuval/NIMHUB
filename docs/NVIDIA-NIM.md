# NVIDIA NIM Integration Guide

## Current baseline
Checked against NVIDIA documentation in October 2026.

NIM LLM/VLM exposes an OpenAI-compatible API including `/v1/chat/completions`, `/v1/responses`, `/v1/messages` and `/v1/models`. Visual GenAI documents OpenAI-compatible image generation/editing and video generation APIs. NVIDIA Speech NIM is a separate ASR/TTS family.

References:
- https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
- https://docs.nvidia.com/nim/visual-genai/latest/api/index.html
- https://docs.nvidia.com/nim/speech/latest/
- https://build.nvidia.com/models

## Hosted access
Use a configurable NVIDIA API key and configurable NIM base URL. Never commit credentials. Do not assume model IDs, quotas, free endpoints or availability are permanent.

## LLM/VLM
Required v0.1: `/v1/models` discovery, streamed chat, tool calling, image input where supported, timeout/cancel handling and structured error mapping.

## Image
Visual GenAI currently documents image generation/editing families including FLUX, Stable Diffusion and Qwen-Image variants. Treat the catalog as volatile; discover/verify against upstream docs.

## Video
Visual GenAI provides OpenAI-compatible video generation. Model video as an asynchronous job and artifact flow.

## Speech
Build: microphone -> ASR -> text -> LLM/agent -> text -> TTS -> audio output. ASR and TTS selectors remain independent.

## Local NIM
The same architecture must allow a locally hosted NIM endpoint later. Provider URL and authentication policy therefore remain configurable.

## Volatile facts
Agents must verify current endpoint shapes, model availability, package versions, limits, GPU requirements and free/partner/download status before encoding them into application logic.
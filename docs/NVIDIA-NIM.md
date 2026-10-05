# NVIDIA NIM Integration Guide

## Current baseline
Checked against NVIDIA documentation in October 2026.

NIM LLM/VLM exposes an OpenAI-compatible API including /v1/chat/completions, /v1/responses, /v1/messages and /v1/models. Visual GenAI documents OpenAI-compatible image generation/editing and video generation APIs. NVIDIA Speech NIM is a separate ASR/TTS family.

References:
- https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
- https://docs.nvidia.com/nim/visual-genai/latest/api/index.html
- https://docs.nvidia.com/nim/speech/latest/
- https://build.nvidia.com/models

## Hosted access
Use a configurable NVIDIA API key and configurable base URL. Never commit credentials. Do not assume model IDs, quotas, free endpoints or availability are permanent.

Hosted Visual GenAI and Speech models can use model/function-specific NVIDIA endpoints. NIM Hub therefore stores a separate endpoint/model profile for Image, Video, ASR and TTS, with an optional dedicated key per profile and fallback to the Chat key.

## LLM/VLM
Required core behavior: /v1/models discovery, streamed chat, tool calling, image input where supported, timeout/cancel handling and structured error mapping.

The Android client must not treat every discovered model as Chat. When provider capability metadata is absent, it uses small conservative ID heuristics for known modality families such as FLUX/Qwen Image, Wan, Parakeet and Magpie; unknown models remain Chat candidates.

## Image
Visual GenAI documents OpenAI-compatible image generation/editing. NIM Hub uses /v1/images/generations for generation and /v1/images/edits with native Android multipart transport for editing. Responses request base64 output so images can be persisted as local artifacts.

## Video
Visual GenAI video deployments expose an OpenAI-compatible job workflow. NIM Hub uses `/v1/videos` for current self-hosted video jobs, polls `/v1/videos/{id}` until completion, then downloads `/v1/videos/{id}/content`. It keeps `/v1/videos/generations` as a compatibility fallback for older synchronous deployments and persists the finished MP4 as a local artifact.

## Speech
Speech NIM exposes multipart ASR at /v1/audio/transcriptions and TTS synthesis at /v1/audio/synthesize. NIM Hub sends microphone/audio payloads through a small Android-native multipart plugin so speech requests do not depend on browser CORS or WebView multipart behavior.

## Voice pipeline
Push-to-talk flow:
microphone → ASR → transcript → NVIDIA Chat → TTS → audio playback.

ASR and TTS endpoint/model/credential profiles are independent.

## Local NIM
The same provider adapter model allows a locally hosted NIM endpoint later. Provider URL and authentication policy remain configurable.

## Volatile facts
Agents must verify current endpoint shapes, model availability, package versions, limits, GPU requirements and free/partner/download status before encoding them into application logic.

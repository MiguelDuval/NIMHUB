# NIM Hub — Reference Projects

These projects are references or building blocks. Do not blindly fork them.

## NVIDIA
NVIDIA Build — https://build.nvidia.com/models
Use for current hosted model catalog, capabilities and API examples.

NIM LLM/VLM — https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
Primary text/VLM API reference.

Visual GenAI NIM — https://docs.nvidia.com/nim/visual-genai/latest/api/index.html
Image, editing and video NIM API reference.

Speech NIM — https://docs.nvidia.com/nim/speech/latest/
Speech/ASR/TTS reference.

NeMo Agent Toolkit — https://github.com/NVIDIA/NeMo-Agent-Toolkit
Agent workflow, observability and NVIDIA-native reference. Use selectively.

Generative AI Examples — https://github.com/NVIDIA/GenerativeAIExamples
Reference implementations and NVIDIA integration patterns.

## MCP
Specification — https://modelcontextprotocol.io/
Official TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk
Official Python SDK — https://github.com/modelcontextprotocol/python-sdk

## GitHub
Official GitHub MCP Server — https://github.com/github/github-mcp-server
Preferred GitHub tool surface.

## Reference UI/product
Open WebUI — https://github.com/open-webui/open-webui
Reference for chat, agents, MCP, voice, files, memory and multimodel UX. Reuse ideas/components only where their licenses and architecture fit; do not import the entire product blindly.

## Important rule
External repositories are references, not hidden dependencies. Prefer package-level SDKs over copying source. Before copying code, verify license, maintenance state and compatibility with the current stack.
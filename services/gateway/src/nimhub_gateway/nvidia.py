from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import httpx

from .settings import settings


# ============================================================================
# Normalized Model Registry
# ============================================================================

@dataclass
class ModelCapability:
    id: str
    name: Optional[str]
    provider: str
    endpoint_family: str
    input_modalities: list[str]
    output_modalities: list[str]
    capabilities: list[str]
    context_window: Optional[int]
    max_output_tokens: Optional[int]
    discovered_at: str
    capability_source: str


# Known model metadata registry (verified capabilities)
KNOWN_MODELS: dict[str, dict] = {
    "nvidia/nemotron-3-ultra": {
        "name": "Nemotron 3 Ultra",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "reasoning", "tool-calling"],
        "context_window": 8192,
        "max_output_tokens": 4096,
    },
    "nvidia/nemotron-4-340b": {
        "name": "Nemotron 4 340B",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "reasoning", "tool-calling"],
        "context_window": 16384,
        "max_output_tokens": 4096,
    },
    "meta/llama-3.1-405b-instruct": {
        "name": "Llama 3.1 405B Instruct",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "tool-calling"],
        "context_window": 131072,
        "max_output_tokens": 4096,
    },
    "meta/llama-3.1-70b-instruct": {
        "name": "Llama 3.1 70B Instruct",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "tool-calling"],
        "context_window": 131072,
        "max_output_tokens": 4096,
    },
    "meta/llama-3.1-8b-instruct": {
        "name": "Llama 3.1 8B Instruct",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "tool-calling"],
        "context_window": 131072,
        "max_output_tokens": 4096,
    },
    "nvidia/nv-vision": {
        "name": "NV-Vision",
        "endpoint_family": "chat",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "vision"],
        "context_window": 4096,
        "max_output_tokens": 2048,
    },
    "mistralai/mixtral-8x7b-instruct-v0.1": {
        "name": "Mixtral 8x7B Instruct",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "tool-calling"],
        "context_window": 32768,
        "max_output_tokens": 4096,
    },
    "mistralai/mistral-large": {
        "name": "Mistral Large",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "reasoning", "tool-calling"],
        "context_window": 32768,
        "max_output_tokens": 4096,
    },
    "nvidia/nemotron-3-8b-code": {
        "name": "Nemotron 3 8B Code",
        "endpoint_family": "chat",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "capabilities": ["chat", "tool-calling"],
        "context_window": 8192,
        "max_output_tokens": 4096,
    },
}


def normalize_model_id(raw_id: str) -> str:
    return raw_id.lower().strip()


def get_known_model(raw_id: str) -> Optional[dict]:
    return KNOWN_MODELS.get(normalize_model_id(raw_id))


def infer_capabilities_heuristic(model_id: str) -> list[str]:
    caps: list[str] = ['chat']
    id_lower = normalize_model_id(model_id)

    # Reasoning indicators
    if any(kw in id_lower for kw in ['reasoning', 'r1', 'nemotron', 'deepseek-r1', 'o1', 'qwq']):
        caps.append('reasoning')

    # Vision indicators
    if any(kw in id_lower for kw in ['vision', 'vlm', 'llava', 'qwen-vl', 'pixtral', 'gpt-4o', 'gemini']):
        caps.append('vision')

    # Tool calling - only for models we're confident support it
    # Require explicit indicators: instruct/chat/nemotron/llama-3/mistral/reasoning
    # AND not a base/pretrain model
    is_base = any(kw in id_lower for kw in ['base', 'pretrain'])
    has_tool_indicators = any(kw in id_lower for kw in ['instruct', 'chat', 'nemotron', 'llama-3', 'mistral', 'reasoning', 'r1', 'deepseek-r1', 'o1', 'qwq'])
    if not is_base and has_tool_indicators:
        caps.append('tool-calling')

    # Image generation
    if any(kw in id_lower for kw in ['flux', 'stable-diffusion', 'sdxl', 'qwen-image', 'dall-e', 'midjourney']):
        caps.append('image-generation')

    # Video generation
    if any(kw in id_lower for kw in ['video', 'svd', 'stable-video', 'gen-2', 'gen-3', 'sora']):
        caps.append('video-generation')

    # ASR
    if any(kw in id_lower for kw in ['asr', 'whisper', 'speech-to-text', 'stt']):
        caps.append('asr')

    # TTS
    if any(kw in id_lower for kw in ['tts', 'text-to-speech', 'parakeet', 'bark', 'xtts']):
        caps.append('tts')

    return caps


def infer_endpoint_family(capabilities: list[str]) -> str:
    if 'image-generation' in capabilities:
        return 'image'
    if 'video-generation' in capabilities:
        return 'video'
    if 'asr' in capabilities or 'tts' in capabilities:
        return 'speech'
    return 'chat'


def infer_modalities(capabilities: list[str]) -> tuple[list[str], list[str]]:
    input_modalities = ['text']
    output_modalities = ['text']

    if 'vision' in capabilities:
        input_modalities.append('image')
    if 'image-generation' in capabilities:
        output_modalities.append('image')
    if 'video-generation' in capabilities:
        output_modalities.append('video')
    if 'asr' in capabilities:
        input_modalities.append('audio')
    if 'tts' in capabilities:
        output_modalities.append('audio')

    return input_modalities, output_modalities


def infer_context_window(model_id: str) -> Optional[int]:
    id_lower = normalize_model_id(model_id)

    if '128k' in id_lower or '131k' in id_lower:
        return 131072
    if '32k' in id_lower:
        return 32768
    if '16k' in id_lower:
        return 16384
    if '8k' in id_lower:
        return 8192
    if '4k' in id_lower:
        return 4096

    if any(kw in id_lower for kw in ['llama-3.1', 'llama-3-1']):
        return 131072
    if any(kw in id_lower for kw in ['nemotron-4']):
        return 16384
    if any(kw in id_lower for kw in ['nemotron', 'llama-3', 'mistral']):
        return 8192

    return None


def normalize_nim_model(raw_model: dict) -> ModelCapability:
    raw_id = raw_model.get('id', '')
    known = get_known_model(raw_id)

    if known:
        input_modalities, output_modalities = infer_modalities(known['capabilities'])
        return ModelCapability(
            id=raw_id,
            name=known.get('name'),
            provider='nvidia',
            endpoint_family=known['endpoint_family'],
            input_modalities=input_modalities,
            output_modalities=output_modalities,
            capabilities=known['capabilities'],
            context_window=known.get('context_window'),
            max_output_tokens=known.get('max_output_tokens'),
            discovered_at='',
            capability_source='registry',
        )
    else:
        caps = infer_capabilities_heuristic(raw_id)
        endpoint_family = infer_endpoint_family(caps)
        input_modalities, output_modalities = infer_modalities(caps)
        context_window = infer_context_window(raw_id)

        return ModelCapability(
            id=raw_id,
            name=raw_model.get('name') or raw_id,
            provider='nvidia',
            endpoint_family=endpoint_family,
            input_modalities=input_modalities,
            output_modalities=output_modalities,
            capabilities=caps,
            context_window=context_window,
            max_output_tokens=None,
            discovered_at='',
            capability_source='heuristic',
        )


class NIMClient:
    def _headers(self) -> dict[str, str]:
        if not settings.nvidia_api_key:
            raise RuntimeError('NVIDIA_API_KEY is not configured')
        return {
            'Authorization': f'Bearer {settings.nvidia_api_key}',
            'Content-Type': 'application/json',
        }

    async def list_models(self) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f'{settings.nvidia_base_url.rstrip("/")}/models',
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()

            raw_models = data.get('data', [])
            normalized = [
                normalize_nim_model(m).__dict__
                for m in raw_models
            ]
            now = datetime.utcnow().isoformat() + 'Z'
            for m in normalized:
                m['discovered_at'] = now

            return {
                'object': 'list',
                'data': normalized,
            }

    async def chat(self, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f'{settings.nvidia_base_url.rstrip("/")}/chat/completions',
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def chat_stream(self, payload: dict) -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                'POST',
                f'{settings.nvidia_base_url.rstrip("/")}/chat/completions',
                headers=self._headers(),
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        yield (line + '\n').encode()

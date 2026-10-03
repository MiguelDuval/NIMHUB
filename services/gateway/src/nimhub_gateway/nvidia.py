from collections.abc import AsyncIterator

import httpx

from .settings import settings


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
            return response.json()

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

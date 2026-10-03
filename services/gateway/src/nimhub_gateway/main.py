from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .nvidia import NIMClient
from .settings import settings

app = FastAPI(title='NIM Hub Gateway', version='0.1.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.nim_hub_allowed_origin],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

nim = NIMClient()


class ChatRequest(BaseModel):
    model: str
    messages: list[dict]
    stream: bool = False
    temperature: float | None = None


@app.get('/api/health')
async def health() -> dict:
    return {
        'ok': True,
        'service': 'nim-hub-gateway',
        'nvidia_configured': bool(settings.nvidia_api_key),
    }


@app.get('/api/models')
async def models() -> dict:
    try:
        return await nim.list_models()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail={'code': 'NVIDIA_NOT_CONFIGURED', 'message': str(exc), 'retryable': False},
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={'code': 'NVIDIA_MODELS_FAILED', 'message': str(exc), 'retryable': True},
        ) from exc


@app.post('/api/chat')
async def chat(request: ChatRequest):
    payload = request.model_dump(exclude_none=True)
    try:
        if request.stream:
            return StreamingResponse(nim.chat_stream(payload), media_type='text/event-stream')
        return await nim.chat(payload)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail={'code': 'NVIDIA_NOT_CONFIGURED', 'message': str(exc), 'retryable': False},
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={'code': 'NVIDIA_CHAT_FAILED', 'message': str(exc), 'retryable': True},
        ) from exc

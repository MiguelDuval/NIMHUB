# NIM Hub — Local Setup

## Prerequisites
- Node.js 22+
- Python 3.11+
- an NVIDIA API key for hosted NIM access

## Configuration
Copy `.env.example` to `.env` and set `NVIDIA_API_KEY`.
Keep the gateway on `127.0.0.1` unless LAN access is intentionally enabled.

## Gateway
From `services/gateway`:
`pip install -e '.[test]'`
`uvicorn nimhub_gateway.main:app --host 127.0.0.1 --port 8787`
Health check: `curl http://127.0.0.1:8787/api/health`

## Client
From `apps/client`:
`npm install`
`npm run dev`
The default client is `http://127.0.0.1:5173`.
When the client must reach a different gateway, use `VITE_GATEWAY_URL`.

## Verification
Client: `npm run typecheck`, `npm run test`, `npm run build`.
Gateway: `pytest -q`.

## Phone
The first target is a responsive PWA. For Android use, make the gateway reachable from the phone network only after deliberately configuring LAN binding and CORS. Never expose the NVIDIA key to the phone's JavaScript bundle.
Native Android packaging is deferred until the PWA workflow is stable.
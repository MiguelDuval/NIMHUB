# NIM Hub — Security

## Threat model
This is a personal application, but it can contain high-value provider credentials. Treat the gateway as the local trust boundary.

## Secrets
Credentials come from environment variables, OS credential storage or an equivalent secret provider. Never commit them.

Initial variable names may include `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `GITHUB_PERSONAL_ACCESS_TOKEN` and an allowed-origin setting.

## Browser
Do not store long-lived provider tokens in localStorage. Prefer gateway-mediated requests.

## Agent
Tool permissions are explicit. Read-only tools can be broadly enabled; writes are scoped; destructive/sensitive actions require approval.

## Logging
Never log authorization headers, API keys, cookies, OAuth tokens or full sensitive tool payloads. Redact known secret fields.

## Network
Bind local development to localhost by default. LAN exposure is opt-in.

## Dependencies
Use lockfiles and automated dependency update checks. Major NIM/MCP SDK upgrades require verification because their APIs can change materially.

## Android later
Use Android Keystore/secure storage when credentials must exist on-device. Never package `.env` into an APK.
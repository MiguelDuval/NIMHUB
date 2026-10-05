import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getMediaProviderConfig, type MediaProviderKind } from './mediaConfig';
import { getMediaModelDefinition } from './mediaCatalog';
import { normalizeNvidiaApiKey } from './nvidiaConfig';

export interface MediaProviderProbe {
  ok: boolean;
  status: number;
  message: string;
  target: string;
}

function assertNative(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Media provider testing is available only in the Android app');
  }
}

function joinEndpoint(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

function readErrorMessage(data: unknown, fallback: string): string {
  const detail = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  const nested = detail.error && typeof detail.error === 'object'
    ? detail.error as Record<string, unknown>
    : {};
  return String(nested.message ?? detail.message ?? fallback);
}

async function request(
  url: string,
  method: 'GET' | 'POST',
  apiKey: string | null,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const response = await CapacitorHttp.request({
    url,
    method,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${normalizeNvidiaApiKey(apiKey)}` } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
    },
    ...(method === 'POST' ? { data: body } : {}),
    connectTimeout: 15000,
    readTimeout: 30000,
    responseType: 'json',
  });
  return { status: response.status, data: response.data };
}

export async function testMediaProvider(
  kind: MediaProviderKind,
  overrides?: { baseUrl?: string; model?: string; apiKey?: string | null },
): Promise<MediaProviderProbe> {
  assertNative();

  const stored = await getMediaProviderConfig(kind);
  const profile = {
    ...stored,
    baseUrl: overrides?.baseUrl?.trim() || stored.baseUrl,
    model: overrides?.model?.trim() || stored.model,
    apiKey: overrides && 'apiKey' in overrides ? (overrides.apiKey?.trim() || null) : stored.apiKey,
  };

  if (!profile.baseUrl) {
    throw new Error(`No API base URL configured for ${kind.toUpperCase()}.`);
  }

  const model = getMediaModelDefinition(profile.model);

  if (model?.availability === 'hosted' && !profile.apiKey) {
    throw new Error(
      `No NVIDIA endpoint-access key configured for the hosted ${model.name} profile. Paste the key from Build.NVIDIA's "Get API Key" action and test again.`,
    );
  }

  if (model?.availability === 'self-hosted') {
    const target = joinEndpoint(profile.baseUrl, '/health/ready');
    const response = await request(target, 'GET', profile.apiKey);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Media NIM rejected the configured API key'
          : readErrorMessage(response.data, `Media NIM readiness probe failed: HTTP ${response.status}`),
      );
    }
    return {
      ok: true,
      status: response.status,
      message: `${model?.name ?? 'NIM'} deployment is live and ready.`,
      target,
    };
  }

  if (model?.transport === 'cosmos3') {
    const target = joinEndpoint(profile.baseUrl, model.endpoint);
    // Cosmos3 does not publish a general GET /models contract for the hosted
    // route. Send an intentionally incomplete request instead: NVIDIA must
    // authenticate the bearer token and route the request, then validation
    // rejects it before any media generation is started.
    const response = await request(target, 'POST', profile.apiKey, {
      model_mode: 'text2image',
      resolution: '480_16_9',
      num_frames: 1,
      num_inference_steps: 35,
      fps: 24,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Cosmos3 rejected the configured endpoint-access key');
    }
    if (response.status === 404 || response.status === 405) {
      throw new Error(`Cosmos3 hosted route is not available at ${target} (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      throw new Error('Cosmos3 is rate-limited right now. The endpoint is reachable and the key was presented.');
    }
    if (response.status === 400 || response.status === 422) {
      return {
        ok: true,
        status: response.status,
        message: `Cosmos3 endpoint is reachable and accepted the endpoint-access key. Test stopped at request validation; no image/video generation was started (HTTP ${response.status}).`,
        target,
      };
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(readErrorMessage(response.data, `Cosmos3 endpoint probe failed: HTTP ${response.status}`));
    }

    return {
      ok: true,
      status: response.status,
      message: 'Cosmos3 endpoint is reachable. Authentication succeeded, and the probe completed without requesting media output.',
      target,
    };
  }

  const target = joinEndpoint(profile.baseUrl, '/models');
  const response = await request(target, 'GET', profile.apiKey);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Media endpoint rejected the configured API key'
        : readErrorMessage(response.data, `Media endpoint probe failed: HTTP ${response.status}`),
    );
  }

  return {
    ok: true,
    status: response.status,
    message: `NVIDIA endpoint is reachable for ${model?.name ?? profile.model}.`,
    target,
  };
}

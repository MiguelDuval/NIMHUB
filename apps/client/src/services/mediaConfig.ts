import { Capacitor } from '@capacitor/core';
import { getNvidiaApiKey, normalizeNvidiaBaseUrl, normalizeNvidiaApiKey } from './nvidiaConfig';
import { secureGet, secureRemove, secureSet } from './secureStorage';

export type MediaProviderKind = 'image' | 'video' | 'asr' | 'tts';

export interface MediaProviderConfig {
  kind: MediaProviderKind;
  apiKey: string | null;
  baseUrl: string;
  model: string;
  voice?: string;
  usesChatKey: boolean;
}

type StoredProfile = Omit<MediaProviderConfig, 'apiKey' | 'usesChatKey'>;

const META_PREFIX = 'nimhub.media.';
const DEFAULTS: Record<MediaProviderKind, StoredProfile> = {
  image: { kind: 'image', baseUrl: 'https://ai.api.nvidia.com/v1', model: 'nvidia/cosmos3-nano' },
  video: { kind: 'video', baseUrl: 'https://ai.api.nvidia.com/v1', model: 'nvidia/cosmos3-nano' },
  asr: { kind: 'asr', baseUrl: '', model: 'parakeet-tdt-0.6b' },
  tts: {
    kind: 'tts',
    baseUrl: '',
    model: 'magpie-tts-multilingual',
    voice: 'Magpie-Multilingual.EN-US.Aria',
  },
};

const KEY_STORAGE: Record<MediaProviderKind, string> = {
  image: 'nvidia.image.api_key',
  video: 'nvidia.video.api_key',
  asr: 'nvidia.asr.api_key',
  tts: 'nvidia.tts.api_key',
};

const META_STORAGE: Record<MediaProviderKind, string> = {
  image: META_PREFIX + 'image',
  video: META_PREFIX + 'video',
  asr: META_PREFIX + 'asr',
  tts: META_PREFIX + 'tts',
};

function assertNative() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Media provider configuration is available only in the Android app');
  }
}

function readMeta(kind: MediaProviderKind): StoredProfile {
  const fallback = DEFAULTS[kind];
  if (typeof window === 'undefined') return fallback;

  const raw = window.localStorage.getItem(META_STORAGE[kind]);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredProfile>;
    const storedModel = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    const storedBaseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
    const isLegacyUnconfiguredVisualProfile =
      (kind === 'image' && storedModel === 'qwen/qwen-image-2512' && !storedBaseUrl) ||
      (kind === 'video' && storedModel === 'wan-ai/wan2.2' && !storedBaseUrl);
    return {
      kind,
      baseUrl: isLegacyUnconfiguredVisualProfile
        ? fallback.baseUrl
        : (storedBaseUrl ? normalizeNvidiaBaseUrl(storedBaseUrl) : ''),
      model: isLegacyUnconfiguredVisualProfile ? fallback.model : (storedModel || fallback.model),
      ...(kind === 'tts'
        ? { voice: typeof parsed.voice === 'string' ? parsed.voice.trim() : fallback.voice }
        : {}),
    };
  } catch {
    window.localStorage.removeItem(META_STORAGE[kind]);
    return fallback;
  }
}

async function readDedicatedKey(kind: MediaProviderKind): Promise<string | null> {
  assertNative();
  const value = await secureGet(KEY_STORAGE[kind]);
  return value?.trim() || null;
}

export async function getMediaProviderConfig(kind: MediaProviderKind): Promise<MediaProviderConfig> {
  assertNative();
  const meta = readMeta(kind);
  const dedicatedKey = await readDedicatedKey(kind);
  const chatKey = await getNvidiaApiKey();
  return {
    ...meta,
    apiKey: dedicatedKey ?? chatKey,
    usesChatKey: !dedicatedKey && Boolean(chatKey),
  };
}

export function getMediaProviderDefaults(kind: MediaProviderKind): StoredProfile {
  return DEFAULTS[kind];
}

export async function saveMediaProviderConfig(
  kind: MediaProviderKind,
  config: { apiKey: string; baseUrl: string; model: string; voice?: string },
): Promise<void> {
  assertNative();
  const model = config.model.trim();
  if (!model) throw new Error('Model ID is required');

  const baseUrl = config.baseUrl.trim();
  const normalizedBaseUrl = baseUrl ? normalizeNvidiaBaseUrl(baseUrl) : '';
  const normalizedKey = config.apiKey.trim();

  if (normalizedKey) {
    await secureSet(KEY_STORAGE[kind], normalizeNvidiaApiKey(normalizedKey));
  } else {
    await secureRemove(KEY_STORAGE[kind]);
  }

  const payload: StoredProfile = {
    kind,
    baseUrl: normalizedBaseUrl,
    model,
    ...(kind === 'tts' ? { voice: (config.voice ?? '').trim() } : {}),
  };

  window.localStorage.setItem(META_STORAGE[kind], JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('nimhub:media-config-changed', { detail: { kind } }));
}

export async function setMediaProviderModel(kind: MediaProviderKind, model: string, baseUrl: string): Promise<void> {
  assertNative();
  const normalizedModel = model.trim();
  if (!normalizedModel) throw new Error('Media model is required');
  const normalizedBaseUrl = baseUrl.trim() ? normalizeNvidiaBaseUrl(baseUrl) : '';
  const current = readMeta(kind);
  const payload: StoredProfile = { ...current, kind, model: normalizedModel, baseUrl: normalizedBaseUrl };
  window.localStorage.setItem(META_STORAGE[kind], JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('nimhub:media-config-changed', { detail: { kind } }));
}

export async function clearMediaProviderConfig(kind: MediaProviderKind): Promise<void> {
  assertNative();
  await secureRemove(KEY_STORAGE[kind]);
  window.localStorage.removeItem(META_STORAGE[kind]);
  window.dispatchEvent(new CustomEvent('nimhub:media-config-changed', { detail: { kind } }));
}

export async function getMediaProviderKeyStatus(kind: MediaProviderKind): Promise<{ dedicated: boolean; effective: boolean }> {
  const config = await getMediaProviderConfig(kind);
  return {
    dedicated: !config.usesChatKey && Boolean(config.apiKey),
    effective: Boolean(config.apiKey),
  };
}

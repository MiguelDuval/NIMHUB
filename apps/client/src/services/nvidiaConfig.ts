import { Capacitor } from '@capacitor/core';
import { normalizeGatewayUrl } from './gatewayConfig';
import { secureGet, secureHas, secureRemove, secureSet } from './secureStorage';

export const NVIDIA_API_KEY_STORAGE = 'nvidia.api_key';
export const NVIDIA_BASE_URL_STORAGE = 'nimhub.nvidia.base_url';
export const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('NVIDIA API base URL is required');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('NVIDIA API base URL must be a valid http:// or https:// URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('NVIDIA API base URL must use http:// or https://');
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

export function getNvidiaBaseUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_NVIDIA_BASE_URL;
  const stored = window.localStorage.getItem(NVIDIA_BASE_URL_STORAGE);
  if (!stored) return DEFAULT_NVIDIA_BASE_URL;
  try {
    return normalizeBaseUrl(stored);
  } catch {
    window.localStorage.removeItem(NVIDIA_BASE_URL_STORAGE);
    return DEFAULT_NVIDIA_BASE_URL;
  }
}

export async function getNvidiaApiKey(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  return secureGet(NVIDIA_API_KEY_STORAGE);
}

export async function hasNvidiaApiKey(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  return secureHas(NVIDIA_API_KEY_STORAGE);
}

export async function saveNvidiaConfig(apiKey: string, baseUrl: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new Error('NVIDIA API key is required');

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!Capacitor.isNativePlatform()) {
    throw new Error('NVIDIA API credentials can be stored only in the native Android app');
  }

  await secureSet(NVIDIA_API_KEY_STORAGE, key);
  window.localStorage.setItem(NVIDIA_BASE_URL_STORAGE, normalizedBaseUrl);
  window.dispatchEvent(
    new CustomEvent('nimhub:nvidia-config-changed', {
      detail: { configured: true, baseUrl: normalizedBaseUrl },
    }),
  );
}

export async function clearNvidiaConfig(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await secureRemove(NVIDIA_API_KEY_STORAGE);
  }
  window.localStorage.removeItem(NVIDIA_BASE_URL_STORAGE);
  window.dispatchEvent(
    new CustomEvent('nimhub:nvidia-config-changed', {
      detail: { configured: false, baseUrl: DEFAULT_NVIDIA_BASE_URL },
    }),
  );
}

export function normalizeNvidiaBaseUrl(value: string): string {
  return normalizeBaseUrl(value);
}

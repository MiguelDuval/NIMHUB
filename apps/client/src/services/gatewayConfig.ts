const STORAGE_KEY = 'nimhub.gateway.url';
const DEFAULT_GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';

export function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Gateway URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Gateway URL must be a valid http:// or https:// URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Gateway URL must use http:// or https://');
  }

  if (!parsed.hostname) {
    throw new Error('Gateway URL must include a host');
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

export function getDefaultGatewayUrl(): string {
  return normalizeGatewayUrl(DEFAULT_GATEWAY_URL);
}

export function getGatewayUrl(): string {
  if (typeof window === 'undefined') {
    return getDefaultGatewayUrl();
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return getDefaultGatewayUrl();
  }

  try {
    return normalizeGatewayUrl(stored);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return getDefaultGatewayUrl();
  }
}

export function setGatewayUrl(value: string): string {
  const normalized = normalizeGatewayUrl(value);
  window.localStorage.setItem(STORAGE_KEY, normalized);
  window.dispatchEvent(
    new CustomEvent('nimhub:gateway-config-changed', {
      detail: { url: normalized },
    }),
  );
  return normalized;
}

export function resetGatewayUrl(): string {
  const fallback = getDefaultGatewayUrl();
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(
    new CustomEvent('nimhub:gateway-config-changed', {
      detail: { url: fallback },
    }),
  );
  return fallback;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, APIError } from '../services/api';
import {
  getGatewayUrl,
  normalizeGatewayUrl,
  setGatewayUrl,
} from '../services/gatewayConfig';

export type GatewayConnectionStatus = 'checking' | 'connected' | 'error';

export interface GatewayStatus {
  url: string;
  status: GatewayConnectionStatus;
  error: APIError | Error | null;
  nvidiaConfigured: boolean | null;
  refresh: () => Promise<void>;
  updateUrl: (value: string) => Promise<void>;
}

export function useGatewayStatus(): GatewayStatus {
  const [url, setUrl] = useState(() => getGatewayUrl());
  const [status, setStatus] = useState<GatewayConnectionStatus>('checking');
  const [error, setError] = useState<APIError | Error | null>(null);
  const [nvidiaConfigured, setNvidiaConfigured] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setStatus('checking');
    setError(null);

    try {
      const health = await api.health();
      setNvidiaConfigured(health.nvidia_configured);
      setStatus(health.ok ? 'connected' : 'error');
      if (!health.ok) {
        setError(new Error('Gateway reported an unhealthy state'));
      }
    } catch (err) {
      setNvidiaConfigured(null);
      setStatus('error');
      setError(
        err instanceof APIError || err instanceof Error
          ? err
          : new Error('Gateway is unreachable'),
      );
    }
  }, []);

  const updateUrl = useCallback(async (value: string) => {
    const normalized = normalizeGatewayUrl(value);
    setGatewayUrl(normalized);
    setUrl(normalized);
  }, []);

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      const nextUrl = detail?.url;
      setUrl(nextUrl ? normalizeGatewayUrl(nextUrl) : getGatewayUrl());
      void refresh();
    };

    window.addEventListener('nimhub:gateway-config-changed', handleChange);
    void refresh();

    return () => {
      window.removeEventListener('nimhub:gateway-config-changed', handleChange);
    };
  }, [refresh]);

  return useMemo(() => ({
    url,
    status,
    error,
    nvidiaConfigured,
    refresh,
    updateUrl,
  }), [url, status, error, nvidiaConfigured, refresh, updateUrl]);
}

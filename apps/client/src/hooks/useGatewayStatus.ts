import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  nvidiaBaseUrl: string;
  adminConfigured: boolean | null;
  refresh: () => Promise<void>;
  updateUrl: (value: string) => Promise<void>;
  saveNvidiaSettings: (
    settings: { apiKey: string; baseUrl: string },
    adminToken: string,
  ) => ReturnType<typeof api.saveNvidiaSettings>;
}

export function useGatewayStatus(): GatewayStatus {
  const [url, setUrl] = useState(() => getGatewayUrl());
  const [status, setStatus] = useState<GatewayConnectionStatus>('checking');
  const [error, setError] = useState<APIError | Error | null>(null);
  const [nvidiaConfigured, setNvidiaConfigured] = useState<boolean | null>(null);
  const [nvidiaBaseUrl, setNvidiaBaseUrl] = useState(
    'https://integrate.api.nvidia.com/v1',
  );
  const [adminConfigured, setAdminConfigured] = useState<boolean | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setStatus('checking');
    setError(null);

    try {
      const health = await api.health();
      if (requestId !== requestIdRef.current) return;
      setNvidiaConfigured(health.nvidia_configured);
      setNvidiaBaseUrl(
        health.nvidia_base_url || 'https://integrate.api.nvidia.com/v1',
      );
      setAdminConfigured(
        health.admin_configured === undefined ? null : health.admin_configured,
      );
      setStatus(health.ok ? 'connected' : 'error');
      if (!health.ok) {
        setError(new Error('Gateway reported an unhealthy state'));
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setNvidiaConfigured(null);
      setNvidiaBaseUrl('https://integrate.api.nvidia.com/v1');
      setAdminConfigured(null);
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

  const saveNvidiaSettings = useCallback(
    async (
      settingsInput: { apiKey: string; baseUrl: string },
      adminToken: string,
    ) => {
      const result = await api.saveNvidiaSettings(settingsInput, adminToken);
      await refresh();
      return result;
    },
    [refresh],
  );

  return useMemo(() => ({
    url,
    status,
    error,
    nvidiaConfigured,
    nvidiaBaseUrl,
    adminConfigured,
    refresh,
    updateUrl,
    saveNvidiaSettings,
  }), [
    url,
    status,
    error,
    nvidiaConfigured,
    nvidiaBaseUrl,
    adminConfigured,
    refresh,
    updateUrl,
    saveNvidiaSettings,
  ]);
}

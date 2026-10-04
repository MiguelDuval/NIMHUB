import { useCallback, useEffect, useState } from 'react';
import {
  clearNvidiaConfig,
  getNvidiaBaseUrl,
  hasNvidiaApiKey,
} from '../services/nvidiaConfig';

export interface NvidiaClientStatus {
  configured: boolean;
  baseUrl: string;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
}

export function useNvidiaStatus(): NvidiaClientStatus {
  const [configured, setConfigured] = useState(false);
  const [baseUrl, setBaseUrl] = useState(getNvidiaBaseUrl());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConfigured(await hasNvidiaApiKey());
      setBaseUrl(getNvidiaBaseUrl());
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    await clearNvidiaConfig();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener('nimhub:nvidia-config-changed', handler);
    void refresh();
    return () => window.removeEventListener('nimhub:nvidia-config-changed', handler);
  }, [refresh]);

  return { configured, baseUrl, loading, refresh, clear };
}

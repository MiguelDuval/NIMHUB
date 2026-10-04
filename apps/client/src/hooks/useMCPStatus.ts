import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { MCPServerSummary, MCPToolSummary } from '../types';

export interface MCPStatus {
  servers: MCPServerSummary[];
  tools: MCPToolSummary[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useMCPStatus(enabled: boolean): MCPStatus {
  const [servers, setServers] = useState<MCPServerSummary[]>([]);
  const [tools, setTools] = useState<MCPToolSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const [serversResult, toolsResult] = await Promise.allSettled([
      api.listMCPServers(),
      api.listMCPTools(),
    ]);

    if (requestId !== requestIdRef.current) return;

    if (serversResult.status === 'fulfilled') {
      setServers(serversResult.value);
    }

    if (toolsResult.status === 'fulfilled') {
      setTools(toolsResult.value);
    }

    const failures = [serversResult, toolsResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    if (failures.length > 0) {
      const firstError = failures[0]?.reason;
      setError(
        firstError instanceof Error
          ? firstError
          : new Error('Failed to discover MCP status'),
      );
    }

    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return {
    servers,
    tools,
    loading,
    error,
    refresh,
  };
}

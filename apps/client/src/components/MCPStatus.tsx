import { useState } from 'react';
import type { MCPServerSummary, MCPToolSummary } from '../types';

interface MCPStatusProps {
  enabled: boolean;
  servers: MCPServerSummary[];
  tools: MCPToolSummary[];
  loading: boolean;
  error: Error | null;
  onRefresh: () => Promise<void>;
}

function permissionLabel(permission: MCPServerSummary['permission'] | MCPToolSummary['permission']) {
  return permission === 'destructive' ? 'destructive' : permission;
}

export function MCPStatus({
  enabled,
  servers,
  tools,
  loading,
  error,
  onRefresh,
}: MCPStatusProps) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!enabled) return null;

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const visibleTools = tools.slice(0, 12);
  const hiddenToolCount = Math.max(0, tools.length - visibleTools.length);
  const statusText = loading
    ? 'MCP …'
    : error
    ? 'MCP unavailable'
    : `MCP · ${servers.length}s / ${tools.length}t`;

  return (
    <div className="mcp-status">
      <button
        className={'mcp-status-toggle ' + (open ? 'active' : '')}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title={error?.message ?? 'Show available MCP servers and tools'}
      >
        <span className={'mcp-status-dot ' + (error ? 'error' : loading ? 'loading' : 'ready')} />
        <span>{statusText}</span>
      </button>

      {open && (
        <div className="mcp-status-popover" role="dialog" aria-label="MCP status">
          <div className="mcp-status-header">
            <div>
              <strong>MCP</strong>
              <span>Runtime tools exposed to Agent</span>
            </div>
            <button
              className="btn-secondary mcp-refresh-btn"
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing || loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {error && (
            <div className="mcp-status-error" role="alert">
              {error.message}
            </div>
          )}

          <section className="mcp-status-section">
            <div className="mcp-status-section-title">Servers</div>
            {servers.length === 0 ? (
              <div className="mcp-empty">No MCP servers configured.</div>
            ) : (
              <div className="mcp-server-list">
                {servers.map((server) => (
                  <div className="mcp-server-row" key={server.id}>
                    <div className="mcp-server-name">
                      <strong>{server.id}</strong>
                      <span>{server.transport === 'stdio' ? 'stdio' : 'HTTP'}</span>
                    </div>
                    <div className="mcp-server-meta">
                      <span className={'mcp-permission ' + server.permission}>
                        {permissionLabel(server.permission)}
                      </span>
                      <span className={server.enabled && server.configured ? 'mcp-ready' : 'mcp-disabled'}>
                        {server.enabled && server.configured ? 'configured' : 'disabled'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mcp-status-section">
            <div className="mcp-status-section-title">Tools</div>
            {visibleTools.length === 0 ? (
              <div className="mcp-empty">No tools discovered.</div>
            ) : (
              <div className="mcp-tool-list">
                {visibleTools.map((tool) => (
                  <div className="mcp-tool-row" key={tool.qualified_name}>
                    <div className="mcp-tool-name">
                      <strong>{tool.name}</strong>
                      <span>{tool.server_id}</span>
                    </div>
                    <div className="mcp-tool-meta">
                      <span className={'mcp-permission ' + tool.permission}>
                        {permissionLabel(tool.permission)}
                      </span>
                      {tool.requires_approval && (
                        <span className="mcp-approval-tag">approval</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hiddenToolCount > 0 && (
              <div className="mcp-tool-overflow">
                +{hiddenToolCount} more tool{hiddenToolCount === 1 ? '' : 's'}
              </div>
            )}
          </section>

          <div className="mcp-status-footer">
            Credentials remain on the gateway. This panel shows sanitized metadata only.
          </div>
        </div>
      )}
    </div>
  );
}

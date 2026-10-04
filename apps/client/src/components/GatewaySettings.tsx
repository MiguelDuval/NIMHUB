import { useEffect, useRef, useState } from 'react';
import type { GatewayConnectionStatus } from '../hooks/useGatewayStatus';
import { getDefaultGatewayUrl } from '../services/gatewayConfig';

interface GatewaySettingsProps {
  url: string;
  status: GatewayConnectionStatus;
  nvidiaConfigured: boolean | null;
  error: Error | null;
  onSave: (value: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

function statusLabel(
  status: GatewayConnectionStatus,
  nvidiaConfigured: boolean | null,
): string {
  if (status === 'checking') return 'Checking gateway…';
  if (status === 'error') return 'Gateway unavailable';
  if (nvidiaConfigured === false) return 'Gateway online · NVIDIA key missing';
  return 'Gateway online';
}

export function GatewaySettings({
  url,
  status,
  nvidiaConfigured,
  error,
  onSave,
  onRefresh,
}: GatewaySettingsProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(url);
  }, [url]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setLocalError(null);
    try {
      await onSave(draft);
      setOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid gateway URL');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(getDefaultGatewayUrl());
    setLocalError(null);
  };

  return (
    <div className="gateway-settings" ref={panelRef}>
      <button
        className={'gateway-status-button ' + status}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title="Configure personal NIM Hub gateway"
      >
        <span className="gateway-status-dot" />
        <span>{statusLabel(status, nvidiaConfigured)}</span>
      </button>

      {open && (
        <div className="gateway-settings-popover" role="dialog" aria-label="Gateway settings">
          <div className="gateway-settings-header">
            <div>
              <strong>Gateway</strong>
              <span>Android connects to your personal FastAPI gateway.</span>
            </div>
            <button
              type="button"
              className="icon-btn gateway-close"
              onClick={() => setOpen(false)}
              aria-label="Close gateway settings"
            >
              ×
            </button>
          </div>

          <label className="gateway-field">
            <span>Gateway URL</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              placeholder="http://192.168.1.10:8787"
              disabled={saving}
            />
          </label>

          <p className="gateway-settings-help">
            On a physical Android phone, use the computer's LAN IP, not 127.0.0.1.
          </p>

          {(localError || error) && (
            <div className="gateway-settings-error" role="alert">
              {(localError ?? error)?.message}
            </div>
          )}

          <div className="gateway-settings-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleReset}
              disabled={saving}
            >
              Default
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void onRefresh()}
              disabled={saving || status === 'checking'}
            >
              {status === 'checking' ? 'Checking…' : 'Test connection'}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleSave()}
              disabled={saving || !draft.trim()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="gateway-settings-status">
            <span className={'gateway-state-dot ' + status} />
            <span>{statusLabel(status, nvidiaConfigured)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

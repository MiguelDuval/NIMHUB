import { useEffect, useRef, useState } from 'react';
import type { GatewayConnectionStatus } from '../hooks/useGatewayStatus';
import type { HealthResponse, NvidiaSettingsResponse } from '../types';
import { getDefaultGatewayUrl } from '../services/gatewayConfig';

interface GatewaySettingsProps {
  url: string;
  status: GatewayConnectionStatus;
  nvidiaConfigured: boolean | null;
  nvidiaBaseUrl: string;
  adminConfigured: boolean | null;
  error: Error | null;
  onSave: (value: string) => Promise<void>;
  onTest: (value: string) => Promise<HealthResponse>;
  onSaveNvidia: (
    settings: { apiKey: string; baseUrl: string },
    adminToken: string,
  ) => Promise<NvidiaSettingsResponse>;
}

function statusLabel(
  status: GatewayConnectionStatus,
  nvidiaConfigured: boolean | null,
  adminConfigured: boolean | null,
): string {
  if (status === 'checking') return 'Checking gateway…';
  if (status === 'error') return 'Setup gateway';
  if (adminConfigured === false) return 'Gateway setup required';
  if (nvidiaConfigured === false) return 'Connect NVIDIA';
  return 'NIM online';
}

export function GatewaySettings({
  url,
  status,
  nvidiaConfigured,
  nvidiaBaseUrl,
  adminConfigured,
  error,
  onSave,
  onTest,
  onSaveNvidia,
}: GatewaySettingsProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const [nvidiaBaseUrlDraft, setNvidiaBaseUrlDraft] = useState(nvidiaBaseUrl);
  const [nvidiaApiKey, setNvidiaApiKey] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [savingGateway, setSavingGateway] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingNvidia, setSavingNvidia] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(url), [url]);
  useEffect(() => setNvidiaBaseUrlDraft(nvidiaBaseUrl), [nvidiaBaseUrl]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const clearMessages = () => {
    setLocalError(null);
    setStatusMessage(null);
  };

  const handleSaveGateway = async () => {
    if (savingGateway || testing || savingNvidia) return;
    setSavingGateway(true);
    clearMessages();
    try {
      await onSave(draft);
      setStatusMessage('Gateway URL saved.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid gateway URL');
    } finally {
      setSavingGateway(false);
    }
  };

  const handleTest = async () => {
    if (savingGateway || testing || savingNvidia) return;
    setTesting(true);
    clearMessages();
    try {
      const health = await onTest(draft);
      setStatusMessage(
        health.nvidia_configured
          ? 'Gateway reachable · NVIDIA is configured'
          : health.admin_configured === false
          ? 'Gateway reachable · set NIM_HUB_ADMIN_TOKEN on the gateway'
          : 'Gateway reachable · add your NVIDIA API key',
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Gateway test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveNvidia = async () => {
    if (
      savingGateway ||
      testing ||
      savingNvidia ||
      !nvidiaApiKey.trim() ||
      !adminToken.trim() ||
      status !== 'connected'
    ) {
      return;
    }
    setSavingNvidia(true);
    clearMessages();
    try {
      const result = await onSaveNvidia(
        {
          apiKey: nvidiaApiKey.trim(),
          baseUrl: nvidiaBaseUrlDraft,
        },
        adminToken.trim(),
      );
      setNvidiaApiKey('');
      setAdminToken('');
      setStatusMessage(
        `NVIDIA connected · ${result.models_available} models discovered`,
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'NVIDIA setup failed');
    } finally {
      setSavingNvidia(false);
    }
  };

  const handleResetDrafts = () => {
    setDraft(url);
    setNvidiaBaseUrlDraft(nvidiaBaseUrl);
    setNvidiaApiKey('');
    setAdminToken('');
    clearMessages();
  };

  return (
    <div className="gateway-settings" ref={panelRef}>
      <button
        className={'gateway-status-button ' + status}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title="Open NIM Hub connection and provider settings"
      >
        <span className="gateway-status-dot" />
        <span>{statusLabel(status, nvidiaConfigured, adminConfigured)}</span>
      </button>

      {open && (
        <div
          className="gateway-settings-popover"
          role="dialog"
          aria-label="NIM Hub settings"
        >
          <div className="gateway-settings-header">
            <div>
              <strong>NIM Hub Settings</strong>
              <span>
                Connect Android to your personal FastAPI gateway and configure NVIDIA NIM.
              </span>
            </div>
            <button
              type="button"
              className="icon-btn gateway-close"
              onClick={() => setOpen(false)}
              aria-label="Close settings"
            >
              ×
            </button>
          </div>

          <section className="gateway-settings-section">
            <div className="gateway-settings-section-title">Gateway connection</div>
            <label className="gateway-field">
              <span>Gateway URL</span>
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  clearMessages();
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                placeholder="http://192.168.1.10:8787"
                disabled={savingGateway || savingNvidia}
              />
            </label>
            <p className="gateway-settings-help">
              Physical Android: use the computer's LAN IP, not 127.0.0.1.
            </p>
            <div className="gateway-settings-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleTest()}
                disabled={savingGateway || testing || savingNvidia}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleSaveGateway()}
                disabled={
                  savingGateway ||
                  testing ||
                  savingNvidia ||
                  !draft.trim() ||
                  draft.trim() === url
                }
              >
                {savingGateway ? 'Saving…' : 'Save gateway'}
              </button>
            </div>
          </section>

          <section className="gateway-settings-section">
            <div className="gateway-settings-section-title">NVIDIA NIM</div>

            <div className="gateway-settings-state">
              <span
                className={
                  'gateway-state-dot ' +
                  (nvidiaConfigured ? 'connected' : 'error')
                }
              />
              <span>
                {nvidiaConfigured
                  ? `Configured on gateway · ${nvidiaBaseUrl}`
                  : 'No NVIDIA API key configured'}
              </span>
            </div>

            <label className="gateway-field">
              <span>NVIDIA API Base URL</span>
              <input
                value={nvidiaBaseUrlDraft}
                onChange={(event) => {
                  setNvidiaBaseUrlDraft(event.target.value);
                  clearMessages();
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                placeholder="https://integrate.api.nvidia.com/v1"
                disabled={savingGateway || savingNvidia}
              />
            </label>

            <label className="gateway-field">
              <span>NVIDIA API Key</span>
              <input
                type="password"
                value={nvidiaApiKey}
                onChange={(event) => {
                  setNvidiaApiKey(event.target.value);
                  clearMessages();
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                placeholder={
                  nvidiaConfigured
                    ? 'Already stored on gateway — enter only to replace'
                    : 'nvapi-…'
                }
                disabled={savingGateway || savingNvidia}
              />
            </label>

            <label className="gateway-field">
              <span>Gateway admin / setup token</span>
              <input
                type="password"
                value={adminToken}
                onChange={(event) => {
                  setAdminToken(event.target.value);
                  clearMessages();
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                placeholder="NIM_HUB_ADMIN_TOKEN"
                disabled={savingGateway || savingNvidia}
              />
            </label>

            <p className="gateway-settings-help">
              NVIDIA credentials are sent only to the gateway. The APK never stores them in localStorage.
              The gateway admin token remains in app memory only for this session.
            </p>
            <p className="gateway-settings-help">
              Get an NVIDIA API key from{' '}
              <a
                className="gateway-settings-link"
                href="https://build.nvidia.com/explore"
                target="_blank"
                rel="noreferrer"
              >
                Build.NVIDIA.com
              </a>.
            </p>

            {adminConfigured === false && (
              <div className="gateway-settings-warning" role="alert">
                Configure <code>NIM_HUB_ADMIN_TOKEN</code> on the gateway first.
              </div>
            )}

            <button
              type="button"
              className="btn-primary gateway-connect-button"
              onClick={() => void handleSaveNvidia()}
              disabled={
                savingGateway ||
                testing ||
                savingNvidia ||
                status !== 'connected' ||
                !nvidiaApiKey.trim() ||
                !adminToken.trim()
              }
            >
              {savingNvidia
                ? 'Verifying & connecting…'
                : nvidiaConfigured
                ? 'Replace NVIDIA key'
                : 'Connect NVIDIA'}
            </button>
          </section>

          {(localError || error) && (
            <div className="gateway-settings-error" role="alert">
              {localError ?? error?.message}
            </div>
          )}

          {statusMessage && (
            <div className="gateway-settings-success" role="status">
              {statusMessage}
            </div>
          )}

          <button
            type="button"
            className="gateway-settings-reset"
            onClick={handleResetDrafts}
            disabled={savingGateway || testing || savingNvidia}
          >
            Reset drafts
          </button>

          <div className="gateway-settings-status">
            <span
              className={
                'gateway-state-dot ' +
                (status === 'connected' ? 'connected' : status)
              }
            />
            <span>{statusLabel(status, nvidiaConfigured, adminConfigured)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

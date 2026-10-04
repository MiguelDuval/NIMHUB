import { useEffect, useState } from 'react';
import { api } from '../services/api';
import {
  clearNvidiaConfig,
  DEFAULT_NVIDIA_BASE_URL,
  getNvidiaBaseUrl,
  normalizeNvidiaBaseUrl,
  saveNvidiaConfig,
} from '../services/nvidiaConfig';
import type { GatewayConnectionStatus } from '../hooks/useGatewayStatus';
import type { HealthResponse } from '../types';

interface SettingsScreenProps {
  open: boolean;
  onClose: () => void;
  nvidiaConfigured: boolean;
  nvidiaBaseUrl: string;
  onNvidiaChanged: () => Promise<void>;
  onRefreshModels: () => Promise<void>;
  gatewayUrl: string;
  gatewayStatus: GatewayConnectionStatus;
  gatewayAdminConfigured: boolean | null;
  onSaveGateway: (value: string) => Promise<void>;
  onTestGateway: (value: string) => Promise<HealthResponse>;
}

export function SettingsScreen({
  open,
  onClose,
  nvidiaConfigured,
  nvidiaBaseUrl,
  onNvidiaChanged,
  onRefreshModels,
  gatewayUrl,
  gatewayStatus,
  gatewayAdminConfigured,
  onSaveGateway,
  onTestGateway,
}: SettingsScreenProps) {
  const [baseUrl, setBaseUrl] = useState(nvidiaBaseUrl || getNvidiaBaseUrl());
  const [apiKey, setApiKey] = useState('');
  const [gatewayDraft, setGatewayDraft] = useState(gatewayUrl);
  const [testingNvidia, setTestingNvidia] = useState(false);
  const [savingGateway, setSavingGateway] = useState(false);
  const [testingGateway, setTestingGateway] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBaseUrl(nvidiaBaseUrl || getNvidiaBaseUrl());
    setGatewayDraft(gatewayUrl);
    setApiKey('');
    setMessage(null);
    setError(null);
  }, [open, nvidiaBaseUrl, gatewayUrl]);

  if (!open) return null;

  const handleNvidiaSave = async () => {
    setTestingNvidia(true);
    setMessage(null);
    setError(null);
    try {
      const normalized = normalizeNvidiaBaseUrl(baseUrl);
      const result = await api.testNvidiaSettings({
        apiKey: apiKey.trim(),
        baseUrl: normalized,
      });
      await saveNvidiaConfig(apiKey.trim(), normalized);
      await onNvidiaChanged();
      await onRefreshModels();
      setApiKey('');
      setBaseUrl(normalized);
      setMessage(
        result.modelsAvailable > 0
          ? `NVIDIA connected · ${result.modelsAvailable} models discovered`
          : 'NVIDIA connected · no models were returned by the endpoint',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify NVIDIA credentials');
    } finally {
      setTestingNvidia(false);
    }
  };

  const handleNvidiaClear = async () => {
    try {
      await clearNvidiaConfig();
      await onNvidiaChanged();
      setMessage('NVIDIA key removed from this device');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove NVIDIA key');
    }
  };

  const handleGatewayTest = async () => {
    setTestingGateway(true);
    setMessage(null);
    setError(null);
    try {
      const health = await onTestGateway(gatewayDraft);
      setMessage(
        health.ok
          ? health.nvidia_configured
            ? 'Gateway online · gateway NVIDIA is configured'
            : 'Gateway online · it will use the app NVIDIA key for runtime requests'
          : 'Gateway reported an unhealthy state',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gateway test failed');
    } finally {
      setTestingGateway(false);
    }
  };

  const handleGatewaySave = async () => {
    setSavingGateway(true);
    setMessage(null);
    setError(null);
    try {
      await onSaveGateway(gatewayDraft);
      setMessage('Gateway URL saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gateway URL is invalid');
    } finally {
      setSavingGateway(false);
    }
  };

  return (
    <div className="settings-overlay" role="presentation">
      <div className="settings-screen" role="dialog" aria-modal="true" aria-label="NIM Hub Settings">
        <header className="settings-screen-header">
          <div>
            <div className="eyebrow">NIM HUB</div>
            <h2>Settings</h2>
            <p>Everything needed to make the Android app usable lives here.</p>
          </div>
          <button className="icon-btn settings-close" type="button" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <div className="settings-scroll">
          <section className="settings-card settings-primary-card">
            <div className="settings-card-title-row">
              <div>
                <span className="settings-kicker">PRIMARY PROVIDER</span>
                <h3>NVIDIA NIM</h3>
              </div>
              <span className={'settings-status-pill ' + (nvidiaConfigured ? 'ok' : 'warn')}>
                {nvidiaConfigured ? 'Connected' : 'Not configured'}
              </span>
            </div>

            <p className="settings-card-copy">
              Enter the API key issued by NVIDIA Build.NVIDIA. On Android the key is stored in encrypted
              app-private storage backed by the Android Keystore. It is never written to localStorage,
              GitHub, or the APK.
            </p>

            <label className="settings-field">
              <span>NVIDIA API Base URL</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                placeholder={DEFAULT_NVIDIA_BASE_URL}
                disabled={testingNvidia}
              />
            </label>

            <label className="settings-field">
              <span>NVIDIA API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                placeholder={nvidiaConfigured ? 'Enter a new key to replace the stored key' : 'nvapi-…'}
                disabled={testingNvidia}
              />
            </label>

            <div className="settings-actions">
              <button
                className="btn-primary"
                type="button"
                onClick={() => void handleNvidiaSave()}
                disabled={testingNvidia || !apiKey.trim()}
              >
                {testingNvidia ? 'Verifying…' : 'Test & save NVIDIA key'}
              </button>
              {nvidiaConfigured && (
                <button className="btn-secondary" type="button" onClick={() => void handleNvidiaClear()} disabled={testingNvidia}>
                  Remove key
                </button>
              )}
            </div>

            <p className="settings-help">
              Key source: <a href="https://build.nvidia.com/explore" target="_blank" rel="noreferrer">Build.NVIDIA.com</a>
            </p>
          </section>

          <section className="settings-card">
            <div className="settings-card-title-row">
              <div>
                <span className="settings-kicker">OPTIONAL TOOL BACKEND</span>
                <h3>Personal Gateway</h3>
              </div>
              <span className={'settings-status-pill ' + (gatewayStatus === 'connected' ? 'ok' : 'neutral')}>
                {gatewayStatus === 'connected' ? 'Online' : 'Optional'}
              </span>
            </div>

            <p className="settings-card-copy">
              Core chat and model discovery do not need a computer or GitHub checkout anymore. The gateway
              is only needed for Agent/MCP/GitHub tooling and other server-side capabilities.
            </p>

            <label className="settings-field">
              <span>Gateway URL</span>
              <input
                value={gatewayDraft}
                onChange={(event) => setGatewayDraft(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                placeholder="http://192.168.1.10:8787"
                disabled={savingGateway || testingGateway}
              />
            </label>

            <div className="settings-actions">
              <button className="btn-secondary" type="button" onClick={() => void handleGatewayTest()} disabled={testingGateway || savingGateway || !gatewayDraft.trim()}>
                {testingGateway ? 'Testing…' : 'Test gateway'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => void handleGatewaySave()} disabled={testingGateway || savingGateway || !gatewayDraft.trim() || gatewayDraft.trim() === gatewayUrl}>
                {savingGateway ? 'Saving…' : 'Save gateway'}
              </button>
            </div>

            <div className="settings-inline-status">
              <span>Runtime NVIDIA key:</span>
              <strong>{nvidiaConfigured ? 'Available to gateway requests' : 'Not configured'}</strong>
            </div>
            <div className="settings-inline-status">
              <span>Gateway admin token:</span>
              <strong>{gatewayAdminConfigured === true ? 'Configured on gateway' : gatewayAdminConfigured === false ? 'Not required for runtime requests' : 'Unknown'}</strong>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-kicker">CAPABILITY STATUS</div>
            <div className="settings-feature-grid">
              <div><strong>Chat</strong><span>Live NVIDIA NIM</span></div>
              <div><strong>Model discovery</strong><span>Live /models</span></div>
              <div><strong>Vision input</strong><span>Available for models that advertise vision</span></div>
              <div><strong>Agent + MCP + GitHub</strong><span>Requires the optional gateway</span></div>
              <div><strong>Image / video generation</strong><span>Engine not exposed in this build yet</span></div>
              <div><strong>ASR / TTS</strong><span>Engine not exposed in this build yet</span></div>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-kicker">MAINTENANCE</div>
            <div className="settings-actions">
              <button className="btn-secondary" type="button" onClick={() => void onRefreshModels()}>
                Refresh models
              </button>
            </div>
            <p className="settings-help">
              GitHub is development infrastructure for the project, not a runtime requirement for using NIM Hub on your phone.
            </p>
          </section>

          {(error || message) && (
            <div className={error ? 'settings-feedback error' : 'settings-feedback success'} role="status">
              {error || message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

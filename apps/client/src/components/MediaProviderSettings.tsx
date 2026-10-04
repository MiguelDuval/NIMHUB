import { useEffect, useState } from 'react';
import {
  clearMediaProviderConfig,
  getMediaProviderConfig,
  getMediaProviderKeyStatus,
  getMediaProviderDefaults,
  saveMediaProviderConfig,
  type MediaProviderKind,
  type MediaProviderConfig,
} from '../services/mediaConfig';

const LABELS: Record<MediaProviderKind, { title: string; description: string; modelPlaceholder: string; baseUrlPlaceholder: string }> = {
  image: {
    title: 'Image generation / editing',
    description: 'Visual GenAI. Use the endpoint shown for the specific visual model; it may differ from the Chat endpoint.',
    modelPlaceholder: 'qwen/qwen-image-2512',
    baseUrlPlaceholder: 'https://<function-id>.invocation.api.nvcf.nvidia.com/v1',
  },
  video: {
    title: 'Video generation',
    description: 'Visual GenAI video. Configure its endpoint/model separately from Chat.',
    modelPlaceholder: 'wan-ai/wan2.2',
    baseUrlPlaceholder: 'https://<function-id>.invocation.api.nvcf.nvidia.com/v1',
  },
  asr: {
    title: 'Speech to text (ASR)',
    description: 'Speech NIM transcription. Android sends microphone audio by native multipart HTTP.',
    modelPlaceholder: 'parakeet-tdt-0.6b',
    baseUrlPlaceholder: 'https://<function-id>.invocation.api.nvcf.nvidia.com/v1',
  },
  tts: {
    title: 'Text to speech (TTS)',
    description: 'Speech NIM synthesis. Configure a voice supported by the selected endpoint.',
    modelPlaceholder: 'magpie-tts-multilingual',
    baseUrlPlaceholder: 'https://<function-id>.invocation.api.nvcf.nvidia.com/v1',
  },
};

interface Props { kind: MediaProviderKind; profile: MediaProviderConfig; onReload: () => Promise<void>; }

function ProviderEditor({ kind, profile, onReload }: Props) {
  const defaults = getMediaProviderDefaults(kind);
  const labels = LABELS[kind];
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl || defaults.baseUrl);
  const [model, setModel] = useState(profile.model || defaults.model);
  const [voice, setVoice] = useState(profile.voice || defaults.voice || '');
  const [apiKey, setApiKey] = useState('');
  const [dedicated, setDedicated] = useState(false);
  const [effective, setEffective] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(profile.baseUrl || defaults.baseUrl);
    setModel(profile.model || defaults.model);
    setVoice(profile.voice || defaults.voice || '');
    setApiKey('');
    setDedicated(!profile.usesChatKey && Boolean(profile.apiKey));
    setEffective(Boolean(profile.apiKey));
    setMessage(null);
    setError(null);
  }, [profile, defaults.baseUrl, defaults.model, defaults.voice]);

  const reloadStatus = async () => {
    const status = await getMediaProviderKeyStatus(kind);
    setDedicated(status.dedicated);
    setEffective(status.effective);
  };

  const save = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await saveMediaProviderConfig(kind, { apiKey, baseUrl, model, voice });
      await reloadStatus();
      await onReload();
      setApiKey('');
      setMessage('Profile saved. Credentials remain in Android secure storage.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save media profile');
    } finally { setBusy(false); }
  };

  const useChatKey = async () => {
    setBusy(true); setError(null);
    try {
      await saveMediaProviderConfig(kind, { apiKey: '', baseUrl, model, voice });
      await reloadStatus();
      setMessage('Dedicated key removed. This profile will use the Chat NVIDIA key.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove dedicated key');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true); setError(null);
    try {
      await clearMediaProviderConfig(kind);
      const fallback = getMediaProviderDefaults(kind);
      setBaseUrl(fallback.baseUrl);
      setModel(fallback.model);
      setVoice(fallback.voice || '');
      await reloadStatus();
      await onReload();
      setMessage('Media profile reset.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset media profile');
    } finally { setBusy(false); }
  };

  return (
    <section className="media-provider-card">
      <div className="settings-card-title-row">
        <div><span className="settings-kicker">NVIDIA NIM · {kind.toUpperCase()}</span><h3>{labels.title}</h3></div>
        <span className={'settings-status-pill ' + (effective ? 'ok' : 'neutral')}>
          {dedicated ? 'Dedicated key' : effective ? 'Chat key' : 'No key'}
        </span>
      </div>
      <p className="settings-card-copy">{labels.description}</p>
      <label className="settings-field">
        <span>API Base URL / Function URL</span>
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" placeholder={labels.baseUrlPlaceholder} disabled={busy} />
      </label>
      <label className="settings-field">
        <span>Model ID</span>
        <input value={model} onChange={(event) => setModel(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={labels.modelPlaceholder} disabled={busy} />
      </label>
      {kind === 'tts' && (
        <label className="settings-field">
          <span>Voice</span>
          <input value={voice} onChange={(event) => setVoice(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Magpie-Multilingual.EN-US.Aria" disabled={busy} />
        </label>
      )}
      <label className="settings-field">
        <span>Dedicated NVIDIA API Key (optional)</span>
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" placeholder={dedicated ? 'Enter a new key to replace the stored key' : 'Leave blank to use Chat NVIDIA key'} disabled={busy} />
      </label>
      <div className="settings-actions">
        <button className="btn-primary" type="button" onClick={() => void save()} disabled={busy || !baseUrl.trim() || !model.trim()}>{busy ? 'Saving…' : 'Save profile'}</button>
        {dedicated && <button className="btn-secondary" type="button" onClick={() => void useChatKey()} disabled={busy}>Use Chat key</button>}
        <button className="btn-secondary" type="button" onClick={() => void reset()} disabled={busy}>Reset</button>
      </div>
      <p className="settings-help">Effective credential: <strong>{effective ? (dedicated ? 'dedicated secure key' : 'Chat secure key') : 'none'}</strong>. The key itself is never shown after saving.</p>
      {(error || message) && <div className={error ? 'settings-feedback error' : 'settings-feedback success'} role="status">{error || message}</div>}
    </section>
  );
}

export function MediaProviderSettings() {
  const [profiles, setProfiles] = useState<Record<MediaProviderKind, MediaProviderConfig> | null>(null);
  const load = async () => {
    const kinds: MediaProviderKind[] = ['image', 'video', 'asr', 'tts'];
    const values = await Promise.all(kinds.map(async (kind) => [kind, await getMediaProviderConfig(kind)] as const));
    setProfiles(Object.fromEntries(values) as Record<MediaProviderKind, MediaProviderConfig>);
  };
  useEffect(() => { void load(); }, []);
  if (!profiles) return <section className="settings-card"><div className="settings-help">Loading media provider profiles…</div></section>;
  return (
    <section className="settings-card">
      <div>
        <div className="settings-kicker">PHASE 2 · MEDIA PROVIDERS</div>
        <h3>Image, video and speech</h3>
        <p className="settings-card-copy">Each function can have its own endpoint/model and NVIDIA API key. A blank dedicated-key field falls back to the secure Chat key.</p>
      </div>
      <ProviderEditor kind="image" profile={profiles.image} onReload={load} />
      <ProviderEditor kind="video" profile={profiles.video} onReload={load} />
      <ProviderEditor kind="asr" profile={profiles.asr} onReload={load} />
      <ProviderEditor kind="tts" profile={profiles.tts} onReload={load} />
    </section>
  );
}

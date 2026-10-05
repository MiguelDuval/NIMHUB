import { useEffect, useMemo, useState } from 'react';
import {
  clearMediaProviderConfig, getMediaProviderConfig, getMediaProviderKeyStatus,
  getMediaProviderDefaults, saveMediaProviderConfig, setMediaProviderModel,
  type MediaProviderKind, type MediaProviderConfig,
} from '../services/mediaConfig';
import { getMediaModelDefinition, getMediaModelsForKind } from '../services/mediaCatalog';
import { testMediaProvider } from '../services/mediaProbe';

interface Props { kind: MediaProviderKind; profile: MediaProviderConfig; onReload: () => Promise<void>; }

function VisualProfileEditor({ kind, profile, onReload }: Props) {
  const models = useMemo(() => getMediaModelsForKind(kind), [kind]);
  const [model, setModel] = useState(profile.model);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [dedicated, setDedicated] = useState(false);
  const [effective, setEffective] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModel(profile.model); setBaseUrl(profile.baseUrl); setApiKey('');
    void getMediaProviderKeyStatus(kind).then((status) => { setDedicated(status.dedicated); setEffective(status.effective); });
  }, [kind, profile]);

  const selected = getMediaModelDefinition(model) ?? models[0];
  const enteredKey = Boolean(apiKey.trim());
  const keyAvailable = enteredKey || effective;
  const keyLabel = enteredKey
    ? 'New key'
    : dedicated
      ? 'Dedicated key'
      : effective
        ? 'Primary NVIDIA key'
        : 'No key';
  const keyHint = selected?.availability === 'hosted'
    ? 'For hosted models, use the endpoint-access key from Build.NVIDIA → Get API Key. The key is kept only in Android secure storage.'
    : 'Leave this blank to reuse the primary NVIDIA key, or enter a dedicated key for this NIM.';

  const selectModel = async (nextId: string) => {
    const next = getMediaModelDefinition(nextId);
    if (!next) return;
    const previous = getMediaModelDefinition(profile.model);
    const baseWasKnownDefault = !profile.baseUrl || profile.baseUrl === previous?.defaultBaseUrl;
    const changingSelfHostedModel = next.availability === 'self-hosted' && next.id !== previous?.id;
    const nextBase = next.defaultBaseUrl || (changingSelfHostedModel ? '' : (baseWasKnownDefault ? '' : profile.baseUrl));
    setModel(next.id); setBaseUrl(nextBase); setError(null);
    try {
      await setMediaProviderModel(kind, next.id, nextBase);
      await onReload();
      setMessage(next.availability === 'hosted'
        ? next.name + ' selected. Enter the hosted endpoint-access key and save it.'
        : next.name + ' selected. Enter the NIM deployment URL below.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not select model'); }
  };

  const save = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await saveMediaProviderConfig(kind, {
        apiKey: apiKey.trim() ? apiKey : undefined,
        baseUrl,
        model,
      });
      await onReload(); setApiKey('');
      setMessage('Profile saved. Credentials remain in Android secure storage.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save media profile'); }
    finally { setBusy(false); }
  };

  const testConnection = async () => {
    setTesting(true); setError(null); setMessage(null);
    try {
      const result = await testMediaProvider(kind, {
        model,
        baseUrl,
        apiKey: enteredKey ? apiKey : profile.apiKey,
      });
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Media endpoint test failed');
    } finally {
      setTesting(false);
    }
  };

  const clearDedicatedKey = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await saveMediaProviderConfig(kind, { apiKey: null, baseUrl, model });
      await onReload();
      setApiKey('');
      setMessage('Dedicated key removed. The profile will reuse the primary NVIDIA key when available.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear dedicated key');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true); setError(null);
    try {
      await clearMediaProviderConfig(kind);
      const fallback = getMediaProviderDefaults(kind);
      setModel(fallback.model); setBaseUrl(fallback.baseUrl);
      await onReload(); setMessage('Reset to the recommended media model.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reset media profile'); }
    finally { setBusy(false); }
  };

  return (
    <section className="media-provider-card">
      <div className="settings-card-title-row">
        <div><span className="settings-kicker">NVIDIA NIM · {kind.toUpperCase()}</span><h3>{kind === 'image' ? 'Image provider' : 'Video provider'}</h3></div>
        <span className={'settings-status-pill ' + (keyAvailable ? 'ok' : 'neutral')}>{keyLabel}</span>
      </div>
      <label className="settings-field">
        <span>Compatible model</span>
        <select value={model} onChange={(event) => void selectModel(event.target.value)} disabled={busy}>
          {models.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.availability === 'hosted' ? 'Hosted' : 'Self-hosted'}{item.functions.includes('image-editing') ? ' · Edit' : ''}</option>)}
        </select>
      </label>
      {selected && <div className="media-model-explainer"><strong>{selected.name}</strong><span>{selected.description}</span><span>{selected.availability === 'hosted' ? 'Endpoint' : 'NIM endpoint'}: <code>{selected.defaultBaseUrl || 'configure below'}</code>{selected.endpoint}</span></div>}
      <label className="settings-field">
        <span>{selected?.availability === 'hosted' ? 'NVIDIA hosted endpoint' : 'NIM invocation / base URL'}</span>
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          placeholder={selected?.defaultBaseUrl || 'https://<your-nim-host>/v1'}
          disabled={busy || selected?.availability === 'hosted'}
        />
      </label>
      <p className="settings-help">
        {selected?.availability === 'hosted'
          ? 'Managed by NVIDIA for this hosted API. You normally do not change this URL.'
          : 'This is not a model name. It is the URL where your deployed NIM is running.'}
      </p>
      <label className="settings-field"><span>{selected?.availability === 'hosted' ? 'Endpoint-access NVIDIA key' : 'Dedicated NVIDIA API key'} <em>optional</em></span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" placeholder={selected?.availability === 'hosted' ? 'Paste the key from Build.NVIDIA → Get API Key' : dedicated ? 'Enter a new key to replace it' : 'Leave blank to reuse the primary NVIDIA key'} disabled={busy} /></label>
      <p className="settings-help">{keyHint}</p>
      <div className="settings-actions"><button className="btn-primary" type="button" onClick={() => void save()} disabled={busy || testing || !model}>{busy ? 'Saving…' : 'Save'}</button><button className="btn-secondary" type="button" onClick={() => void testConnection()} disabled={busy || testing || !model || (!keyAvailable && selected?.availability === 'hosted')}>{testing ? 'Testing…' : 'Test connection'}</button>{dedicated && <button className="btn-secondary" type="button" onClick={() => void clearDedicatedKey()} disabled={busy || testing}>Use primary key</button>}<button className="btn-secondary" type="button" onClick={() => void reset()} disabled={busy || testing}>Reset</button></div>
      <p className="settings-help">Credential: <strong>{enteredKey ? 'new key entered' : effective ? (dedicated ? 'dedicated secure key' : 'primary secure key') : 'none'}</strong>. Endpoint is selected by the model. Connection test verifies endpoint routing/auth without intentionally starting media generation.</p>
      {(error || message) && <div className={error ? 'settings-feedback error' : 'settings-feedback success'} role="status">{error || message}</div>}
    </section>
  );
}

function SpeechProfileEditor({ kind, profile, onReload }: Props) {
  const defaults = getMediaProviderDefaults(kind);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl); const [model, setModel] = useState(profile.model);
  const [voice, setVoice] = useState(profile.voice || defaults.voice || ''); const [apiKey, setApiKey] = useState('');
  const [dedicated, setDedicated] = useState(false); const [effective, setEffective] = useState(false);
  const [busy, setBusy] = useState(false); const [testing, setTesting] = useState(false); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { setBaseUrl(profile.baseUrl); setModel(profile.model); setVoice(profile.voice || defaults.voice || ''); setApiKey(''); void getMediaProviderKeyStatus(kind).then((s) => { setDedicated(s.dedicated); setEffective(s.effective); }); }, [kind, profile, defaults.voice]);
  const enteredKey = Boolean(apiKey.trim());
  const keyAvailable = enteredKey || effective;
  const clearDedicatedKey = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await saveMediaProviderConfig(kind, { apiKey: null, baseUrl, model, voice });
      await onReload();
      setApiKey('');
      setMessage('Dedicated key removed. The profile will reuse the primary NVIDIA key when available.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear dedicated key');
    } finally { setBusy(false); }
  };
  const save = async () => { setBusy(true); setError(null); setMessage(null); try { await saveMediaProviderConfig(kind, { apiKey: apiKey.trim() ? apiKey : undefined, baseUrl, model, voice }); await onReload(); setApiKey(''); setMessage('Voice profile saved.'); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save voice profile'); } finally { setBusy(false); } };
  return (
    <section className="media-provider-card compact">
      <div className="settings-card-title-row"><div><span className="settings-kicker">{kind.toUpperCase()}</span><h3>{kind === 'asr' ? 'Speech to text' : 'Text to speech'}</h3></div><span className={'settings-status-pill ' + (keyAvailable ? 'ok' : 'neutral')}>{enteredKey ? 'New key' : dedicated ? 'Dedicated key' : effective ? 'Primary key' : 'No key'}</span></div>
      <p className="settings-card-copy">{kind === 'asr' ? 'Microphone transcription profile.' : 'Speech synthesis profile used after Chat.'}</p>
      <label className="settings-field"><span>Base URL / Function URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://<function-id>.invocation.api.nvcf.nvidia.com/v1" disabled={busy} /></label>
      <label className="settings-field"><span>Model ID</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder={defaults.model} disabled={busy} /></label>
      {kind === 'tts' && <label className="settings-field"><span>Voice</span><input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="Magpie-Multilingual.EN-US.Aria" disabled={busy} /></label>}
      <label className="settings-field"><span>Dedicated NVIDIA API key <em>optional</em></span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={dedicated ? 'Enter a new key' : 'Leave blank to reuse the primary NVIDIA key'} disabled={busy} /></label>
      <div className="settings-actions"><button className="btn-primary" onClick={() => void save()} disabled={busy || !model}>{busy ? 'Saving…' : 'Save'}</button>{dedicated && <button className="btn-secondary" onClick={() => void clearDedicatedKey()} disabled={busy}>Use primary key</button>}</div>
      <p className="settings-help">Credential: <strong>{enteredKey ? 'new key entered' : effective ? (dedicated ? 'dedicated secure key' : 'primary secure key') : 'none'}</strong>. Leave the key blank to reuse the primary NVIDIA credential.</p>
      {(error || message) && <div className={error ? 'settings-feedback error' : 'settings-feedback success'} role="status">{error || message}</div>}
    </section>
  );
}

export function MediaProviderSettings() {
  const [profiles, setProfiles] = useState<Record<MediaProviderKind, MediaProviderConfig> | null>(null);
  const load = async () => { const kinds: MediaProviderKind[] = ['image', 'video', 'asr', 'tts']; const values = await Promise.all(kinds.map(async (kind) => [kind, await getMediaProviderConfig(kind)] as const)); setProfiles(Object.fromEntries(values) as Record<MediaProviderKind, MediaProviderConfig>); };
  useEffect(() => { void load(); }, []);
  if (!profiles) return <section className="settings-card"><div className="settings-help">Loading media provider catalog…</div></section>;
  return (
    <section className="settings-card">
      <div><div className="settings-kicker">MEDIA SERVICES</div><h3>Target-specific NVIDIA profiles</h3><p className="settings-card-copy">Image and Video show only models that belong to that function. Hosted models have a known endpoint; self-hosted NIMs ask for the deployment URL.</p></div>
      <VisualProfileEditor kind="image" profile={profiles.image} onReload={load} />
      <VisualProfileEditor kind="video" profile={profiles.video} onReload={load} />
      <details className="advanced-voice-settings"><summary>Advanced Voice service profiles</summary><div className="advanced-voice-content"><SpeechProfileEditor kind="asr" profile={profiles.asr} onReload={load} /><SpeechProfileEditor kind="tts" profile={profiles.tts} onReload={load} /></div></details>
    </section>
  );
}

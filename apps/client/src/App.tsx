import { useEffect, useMemo, useState } from 'react';

type Model = { id?: string; name?: string };

const gateway = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';

export default function App() {
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Connecting…');

  useEffect(() => {
    fetch(`${gateway}/api/models`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Gateway returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list = Array.isArray(data?.data) ? data.data : [];
        setModels(list);
        setSelected(list[0]?.id ?? '');
        setStatus('Connected');
      })
      .catch((error: Error) => setStatus(`Gateway unavailable: ${error.message}`));
  }, []);

  const canSend = useMemo(() => Boolean(message.trim() && selected && !busy), [message, selected, busy]);

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setReply('');
    try {
      const r = await fetch(`${gateway}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: selected, messages: [{ role: 'user', content: message }], stream: false }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail?.message ?? data?.detail ?? `Request failed: ${r.status}`);
      setReply(data?.choices?.[0]?.message?.content ?? '');
    } catch (error) {
      setReply(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">PERSONAL AI WORKSTATION</div>
          <h1>NIM Hub</h1>
        </div>
        <div className="status">● {status}</div>
      </header>
      <section className="workspace">
        <div className="card conversation">
          <div className="card-title">Chat</div>
          <div className="messages">
            <div className="message user">{message || 'Your next request will appear here.'}</div>
            <div className="message assistant">{reply || 'NVIDIA NIM response will appear here.'}</div>
          </div>
        </div>
        <div className="card composer">
          <label htmlFor="model">Model</label>
          <select id="model" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!models.length || busy}>
            {!models.length && <option value="">No models discovered</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.id ?? model.name}</option>)}
          </select>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask NIM Hub anything…" rows={4} />
          <div className="composer-row">
            <span className="hint">Gateway: {gateway}</span>
            <button onClick={send} disabled={!canSend}>{busy ? 'Working…' : 'Send'}</button>
          </div>
        </div>
      </section>
    </main>
  );
}

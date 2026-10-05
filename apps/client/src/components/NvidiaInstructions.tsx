import { useEffect } from 'react';

interface Props { open: boolean; onClose: () => void; }

export function NvidiaInstructions({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="instructions-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="instructions-dialog" role="dialog" aria-modal="true" aria-label="NVIDIA NIM instructions">
        <header className="instructions-header">
          <div>
            <div className="settings-kicker">NVIDIA · QUICK GUIDE</div>
            <h2>What each model is for</h2>
            <p>Choose a recommended model first. Advanced endpoint editing is only needed for self-hosted NIMs.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close instructions">×</button>
        </header>
        <div className="instructions-scroll">
          <section className="instructions-card">
            <strong>Chat</strong>
            <p>Chat uses OpenAI-compatible <code>/v1/chat/completions</code>. The main model selector shows only Chat-capable models.</p>
            <p className="instructions-note">One NVIDIA API key can be reused across hosted services when that key has access to the target endpoint. A dedicated media key is optional.</p>
            <p>For self-hosted NIMs, inference is normally local HTTP: the deployment URL is the important setting, and NIM Hub does not require a Cloud API key for that path.</p>
          </section>
          <section className="instructions-card">
            <strong>Image</strong>
            <div className="instructions-model"><b>Cosmos3 Nano</b><span>Hosted · text→image</span></div>
            <p>Recommended first test. NIM Hub knows its hosted route automatically. It is generation-only in Image Studio.</p>
            <div className="instructions-model"><b>Qwen-Image 2512</b><span>Self-hosted NIM · image generation</span></div>
            <div className="instructions-model"><b>Qwen Image Edit 2511</b><span>Self-hosted NIM · image editing</span></div>
          </section>
          <section className="instructions-card">
            <strong>Video</strong>
            <div className="instructions-model"><b>Cosmos3 Nano</b><span>Hosted · text→video / image→video</span></div>
            <div className="instructions-model"><b>Wan2.2</b><span>Self-hosted NIM · text→video / image→video</span></div>
            <p>Wan2.2 needs the invocation/base URL of its deployment. It must not be paired with the generic Chat URL. A local NIM can be keyless unless your own gateway adds authentication.</p>
          </section>
          <section className="instructions-card">
            <strong>Agent / MCP</strong>
            <p>Agent mode is a tool-calling loop: the Chat model receives MCP tool definitions, returns tool calls, and the Personal Gateway executes them with permission checks and approvals.</p>
            <p className="instructions-note">First test: connect Personal Gateway, select a tool-capable model such as Nemotron 3 Ultra, enable Agent, then ask for a harmless read-only task.</p>
          </section>
          <section className="instructions-card instructions-warning-card">
            <strong>Why media can fail</strong>
            <p>Chat, Visual GenAI NIMs and hosted Cosmos3 use different routes. NIM Hub now selects the transport from the chosen model instead of assuming every model speaks the same media API.</p>
          </section>
        </div>
        <footer className="instructions-footer">
          <a href="https://build.nvidia.com/models" target="_blank" rel="noreferrer">NVIDIA model catalog</a>
          <a href="https://docs.nvidia.com/nim/visual-genai/latest/" target="_blank" rel="noreferrer">Visual GenAI docs</a>
          <a href="https://docs.nvidia.com/nim/large-language-models/latest/" target="_blank" rel="noreferrer">NIM LLM docs</a>
        </footer>
      </section>
    </div>
  );
}

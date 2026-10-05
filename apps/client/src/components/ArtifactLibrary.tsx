import { useCallback, useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { storage } from '../services/storage';
import type { Artifact, ArtifactType } from '../types';

type Filter = 'all' | ArtifactType;

interface NimhubFilePlugin {
  saveBase64(options: {
    fileName: string;
    mimeType: string;
    dataBase64: string;
  }): Promise<{ uri: string; fileName: string; mimeType: string }>;
}

const NativeFile = registerPlugin<NimhubFilePlugin>('NimhubFile');

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read artifact'));
    reader.readAsDataURL(blob);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(artifact.blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [artifact]);

  if (!url) return <div className="artifact-preview-empty">Loading…</div>;
  if (artifact.type === 'image') return <img className="artifact-preview-image" src={url} alt={artifact.name} />;
  if (artifact.type === 'video') return <video className="artifact-preview-video" src={url} controls playsInline />;
  if (artifact.type === 'audio') return <audio className="artifact-preview-audio" src={url} controls />;
  return <div className="artifact-preview-empty">Preview unavailable</div>;
}

export function ArtifactLibrary() {
  const [filter, setFilter] = useState<Filter>('all');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setArtifacts(await storage.getArtifacts(filter === 'all' ? undefined : filter));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (artifact: Artifact) => {
    await storage.deleteArtifact(artifact.id);
    await load();
  };

  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const download = async (artifact: Artifact) => {
    setExportingId(artifact.id);
    setExportMessage(null);
    try {
      if (Capacitor.isNativePlatform()) {
        await NativeFile.saveBase64({
          fileName: artifact.name,
          mimeType: artifact.mimeType,
          dataBase64: await blobToBase64(artifact.blob),
        });
        setExportMessage(`Saved ${artifact.name} to the Android media library.`);
        return;
      }

      const url = URL.createObjectURL(artifact.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(`Saved ${artifact.name}.`);
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : 'Could not save file');
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="artifact-library">
      <header className="artifact-library-header">
        <div>
          <span className="settings-kicker">LOCAL ARTIFACTS</span>
          <h2>Media Library</h2>
          <p>Generated files are kept locally on this Android device. Nothing is uploaded to NIM Hub just to display the library.</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
      </header>
      {exportMessage && <div className="settings-feedback success" role="status">{exportMessage}</div>}

      <div className="artifact-filter-row" role="tablist" aria-label="Artifact type">
        {(['all', 'image', 'video', 'audio'] as Filter[]).map((item) => (
          <button
            key={item}
            className={'mode-toggle ' + (filter === item ? 'active' : '')}
            type="button"
            role="tab"
            aria-selected={filter === item}
            onClick={() => setFilter(item)}
          >
            {item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="artifact-empty">Loading library…</div>
      ) : artifacts.length === 0 ? (
        <div className="artifact-empty">
          <strong>No {filter === 'all' ? 'artifacts' : filter + ' artifacts'} yet.</strong>
          <span>Generate an image, video, or voice result and it will appear here.</span>
        </div>
      ) : (
        <div className="artifact-grid">
          {artifacts.map((artifact) => (
            <article className="artifact-card" key={artifact.id}>
              <ArtifactPreview artifact={artifact} />
              <div className="artifact-card-body">
                <strong>{artifact.name}</strong>
                <span>{artifact.type} · {formatBytes(artifact.size)}</span>
                <time dateTime={artifact.createdAt}>{new Date(artifact.createdAt).toLocaleString()}</time>
              </div>
              <div className="artifact-card-actions">
                <button className="btn-secondary" type="button" onClick={() => void download(artifact)} disabled={exportingId !== null}>{exportingId === artifact.id ? 'Saving…' : 'Save to device'}</button>
                <button className="btn-secondary danger-button" type="button" onClick={() => void remove(artifact)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

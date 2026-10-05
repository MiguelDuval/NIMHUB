import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { editImage, generateImage, generateVideo, synthesizeSpeech, transcribeAudio, type VideoGenerationProgress } from '../services/mediaApi';
import { storage } from '../services/storage';
import { getMediaModelDefinition, getMediaModelsForKind } from '../services/mediaCatalog';
import { getMediaProviderConfig, setMediaProviderModel, type MediaProviderConfig } from '../services/mediaConfig';
import type { ImageEditResponse, ImageGenerationResponse, VideoGenerationResponse } from '../types';

export type MediaMode = 'image' | 'voice' | 'video';

interface MediaStudioProps {
  mode: MediaMode;
  chatModelId: string;
  nvidiaConfigured: boolean;
  onOpenSettings: () => void;
}

interface ArtifactPreview {
  id: string;
  type: 'image' | 'audio' | 'video';
  url: string;
  name: string;
}

function firstBase64Image(response: ImageGenerationResponse | ImageEditResponse): string | null {
  return response.data?.[0]?.b64_json ?? null;
}
function firstBase64Video(response: VideoGenerationResponse): string | null {
  const item = Array.isArray(response.data) ? response.data[0] : response.data;
  return item?.b64_json ?? null;
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const data = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) data[i] = bytes.charCodeAt(i);
  return new Blob([data], { type: mimeType });
}

export function MediaStudio({ mode, chatModelId, nvidiaConfigured, onOpenSettings }: MediaStudioProps) {
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [voice, setVoice] = useState('');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ArtifactPreview | null>(null);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [imageOperation, setImageOperation] = useState<'generate' | 'edit'>('generate');
  const [videoImage, setVideoImage] = useState<File | null>(null);
  const [videoSeconds, setVideoSeconds] = useState(4);
  const [videoProgress, setVideoProgress] = useState<VideoGenerationProgress | null>(null);
  const [imageSize, setImageSize] = useState('1024x1024');
  const [videoSize, setVideoSize] = useState('832x480');
  const [mediaProfile, setMediaProfile] = useState<MediaProviderConfig | null>(null);
  const [mediaModelId, setMediaModelId] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const artifactUrlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const visualKind = mode === 'image' || mode === 'video' ? mode : null;
  const mediaModels = useMemo(() => (visualKind ? getMediaModelsForKind(visualKind) : []), [visualKind]);
  const visibleMediaModels = useMemo(
    () => mode === 'image'
      ? mediaModels.filter((item) => item.functions.includes(
        imageOperation === 'generate' ? 'image-generation' : 'image-editing',
      ))
      : mediaModels,
    [imageOperation, mediaModels, mode],
  );
  const selectedMediaModel = getMediaModelDefinition(mediaModelId);

  const visualProviderReady = Boolean(
    mediaProfile?.baseUrl &&
    selectedMediaModel &&
    (selectedMediaModel.availability === 'self-hosted' || mediaProfile.apiKey),
  );

  const loadMediaProfile = useCallback(async () => {
    if (!visualKind) {
      setMediaProfile(null);
      setMediaModelId('');
      return;
    }

    try {
      const profile = await getMediaProviderConfig(visualKind);
      setMediaProfile(profile);
      const inCatalog = Boolean(getMediaModelDefinition(profile.model)) &&
        visibleMediaModels.some((item) => item.id === profile.model);
      setMediaModelId(inCatalog ? profile.model : visibleMediaModels[0]?.id ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load media profile');
    }
  }, [visibleMediaModels, visualKind]);

  useEffect(() => {
    void loadMediaProfile();
    if (typeof window === 'undefined' || !visualKind) return;

    const handleConfigChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind === visualKind) void loadMediaProfile();
    };
    window.addEventListener('nimhub:media-config-changed', handleConfigChanged);
    return () => window.removeEventListener('nimhub:media-config-changed', handleConfigChanged);
  }, [loadMediaProfile, visualKind]);

  const handleMediaModelChange = useCallback(async (nextId: string) => {
    if (!visualKind || !visibleMediaModels.some((item) => item.id === nextId)) return;
    const next = getMediaModelDefinition(nextId);
    if (!next) return;
    const previous = getMediaModelDefinition(mediaModelId);
    const currentBase = mediaProfile?.baseUrl ?? '';
    const baseWasKnownDefault = !currentBase || currentBase === previous?.defaultBaseUrl;
    const changingSelfHostedModel = next.availability === 'self-hosted' && next.id !== previous?.id;
    const nextBase = next.defaultBaseUrl || (changingSelfHostedModel ? '' : (baseWasKnownDefault ? '' : currentBase));
    setMediaModelId(next.id);
    setMediaProfile((current) => current ? { ...current, model: next.id, baseUrl: nextBase } : current);
    try { await setMediaProviderModel(visualKind, next.id, nextBase); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not select media model'); }
  }, [mediaModelId, mediaProfile?.baseUrl, visualKind, visibleMediaModels]);

  useEffect(() => {
    if (mode !== 'image') return;
    if (selectedMediaModel && visibleMediaModels.some((item) => item.id === selectedMediaModel.id)) return;
    const fallback = visibleMediaModels[0];
    if (fallback) void handleMediaModelChange(fallback.id);
  }, [handleMediaModelChange, mode, selectedMediaModel, visibleMediaModels]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.pause();
    if (artifactUrlRef.current) URL.revokeObjectURL(artifactUrlRef.current);
  }, []);

  const clearArtifact = useCallback(() => {
    if (artifactUrlRef.current) URL.revokeObjectURL(artifactUrlRef.current);
    artifactUrlRef.current = null;
    setArtifact(null);
  }, []);

  const saveArtifact = useCallback(async (type: ArtifactPreview['type'], blob: Blob, name: string) => {
    const saved = await storage.saveArtifact({
      type,
      mimeType: blob.type || (type === 'image' ? 'image/png' : type === 'audio' ? 'audio/wav' : 'video/mp4'),
      name,
      blob,
    });
    const url = URL.createObjectURL(blob);
    artifactUrlRef.current = url;
    setArtifact({ id: saved.id, type, url, name });
  }, []);

  const runImageGenerate = async () => {
    if (!prompt.trim()) return;
    if (!visualProviderReady) { onOpenSettings(); return; }
    if (!selectedMediaModel?.functions.includes('image-generation')) { setError('Selected model does not support image generation.'); return; }
    setBusy(true); setError(null); clearArtifact();
    try {
      const response = await generateImage({ model: selectedMediaModel?.id ?? '', prompt: prompt.trim(), size: imageSize, n: 1, response_format: 'b64_json' });
      const base64 = firstBase64Image(response);
      if (!base64) throw new Error('Image endpoint returned no base64 image');
      const mimeType = selectedMediaModel?.transport === 'cosmos3' ? 'image/jpeg' : 'image/png';
      await saveArtifact('image', base64ToBlob(base64, mimeType), 'nimhub-image.' + (mimeType === 'image/jpeg' ? 'jpg' : 'png'));
    } catch (err) { setError(err instanceof Error ? err.message : 'Image generation failed'); }
    finally { setBusy(false); }
  };

  const handleReferenceImageChange = async (file: File | null) => {
    setReferenceImage(file);
    if (!file || !visualKind || visualKind !== 'image') return;

    setImageOperation('edit');
    const editingModel = mediaModels.find((item) => item.functions.includes('image-editing'));
    if (editingModel && !selectedMediaModel?.functions.includes('image-editing')) {
      await handleMediaModelChange(editingModel.id);
    }
  };

  const runImageEdit = async () => {
    if (!prompt.trim() || !referenceImage) return;
    if (!visualProviderReady) { onOpenSettings(); return; }
    if (!selectedMediaModel?.functions.includes('image-editing')) { setError('Select Qwen Image Edit 2511 for reference-image editing.'); return; }
    setBusy(true); setError(null); clearArtifact();
    try {
      const response = await editImage({
        model: selectedMediaModel?.id ?? '', prompt: prompt.trim(), image: referenceImage,
        fileName: referenceImage.name, mimeType: referenceImage.type,
        n: 1, response_format: 'b64_json',
      });
      const base64 = firstBase64Image(response);
      if (!base64) throw new Error('Image edit endpoint returned no base64 image');
      await saveArtifact('image', base64ToBlob(base64, 'image/png'), 'nimhub-edited-image.png');
    } catch (err) { setError(err instanceof Error ? err.message : 'Image editing failed'); }
    finally { setBusy(false); }
  };

  const transcribe = async (audio: Blob) => {
    setBusy(true); setError(null);
    try {
      const text = await transcribeAudio(audio, { language, wordTimeOffsets: false });
      setTranscript(text);
      await storage.saveArtifact({ type: 'audio', mimeType: audio.type || 'audio/webm', name: 'nimhub-recording.webm', blob: audio });
    } catch (err) { setError(err instanceof Error ? err.message : 'ASR failed'); }
    finally { setBusy(false); }
  };

  const startRecording = async () => {
    setError(null); setTranscript('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This Android WebView does not expose microphone recording');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      streamRef.current = stream; recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const audio = new Blob(chunksRef.current, { type: mimeType });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null; recorderRef.current = null; setRecording(false);
        void transcribe(audio);
      };
      recorder.start();
      setRecording(true);
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(err instanceof Error ? err.message : 'Could not start microphone');
    }
  };

  const askAndSpeak = async () => {
    if (!transcript.trim()) return;
    if (!nvidiaConfigured) { onOpenSettings(); return; }
    if (!chatModelId) { setError('Choose a Chat model before voice conversation'); return; }
    setBusy(true); setError(null); setAnswer('');
    try {
      const response = await api.chat({ model: chatModelId, stream: false, messages: [{ role: 'user', content: transcript.trim() }] });
      const content = response.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text) throw new Error('Chat returned no text for voice conversation');
      setAnswer(text);
      const speech = await synthesizeSpeech(text, { language, voice: voice.trim() || undefined });
      await saveArtifact('audio', speech.audio, 'nimhub-response.wav');
      if (artifactUrlRef.current) {
        const player = new Audio(artifactUrlRef.current);
        audioRef.current = player;
        await player.play();
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Voice conversation failed'); }
    finally { setBusy(false); }
  };

  const runVideo = async () => {
    if (!prompt.trim()) return;
    if (!visualProviderReady) { onOpenSettings(); return; }
    if (!selectedMediaModel?.functions.includes('video-generation')) { setError('Selected model does not support video generation.'); return; }
    setBusy(true); setError(null); clearArtifact(); setVideoProgress(null);
    try {
      const inputReference = videoImage ? await fileToDataUrl(videoImage) : undefined;
      const response = await generateVideo(
        { model: selectedMediaModel?.id ?? '', prompt: prompt.trim(), size: videoSize, seconds: videoSeconds, input_reference: inputReference },
        setVideoProgress,
      );
      const base64 = firstBase64Video(response);
      if (!base64) throw new Error('Video endpoint returned no base64 video');
      await saveArtifact('video', base64ToBlob(base64, 'video/mp4'), 'nimhub-video.mp4');
    } catch (err) { setError(err instanceof Error ? err.message : 'Video generation failed'); }
    finally { setBusy(false); }
  };

  if (mode === 'image') return (
    <div className="media-studio">
      <div className="media-studio-header">
        <div><span className="settings-kicker">MEDIA STUDIO · IMAGE</span><h2>Generate or edit an image</h2><p>Only image-capable NVIDIA models appear here. Hosted models need an endpoint-access key; self-hosted NIMs may run without an API key.</p></div>
        {!visualProviderReady && <button className="btn-primary" onClick={onOpenSettings}>Configure media</button>}
      </div>
      <div className="media-action-row">
        <button className={imageOperation === 'generate' ? 'btn-primary' : 'btn-secondary'} type="button" onClick={() => setImageOperation('generate')} disabled={busy}>Generate</button>
        <button className={imageOperation === 'edit' ? 'btn-primary' : 'btn-secondary'} type="button" onClick={() => setImageOperation('edit')} disabled={busy}>Edit reference</button>
      </div>
      <section className="media-model-card"><label className="settings-field"><span>{imageOperation === 'generate' ? 'Generation model' : 'Editing model'}</span><select value={mediaModelId} onChange={(event) => void handleMediaModelChange(event.target.value)} disabled={busy}>{visibleMediaModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.availability === "hosted" ? "Hosted" : "Self-hosted"}</option>)}</select></label>{selectedMediaModel && <div className="media-model-explainer"><strong>{selectedMediaModel.name}</strong><span>{selectedMediaModel.description}</span><span>Route: <code>{selectedMediaModel.defaultBaseUrl || "configure in Settings"}</code>{selectedMediaModel.endpoint}</span></div>}</section><label className="media-prompt-field"><span>Prompt</span><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image…" disabled={busy} /></label>
      <div className="media-control-grid">
        <label className="settings-field"><span>Size</span><select value={imageSize} onChange={(e) => setImageSize(e.target.value)} disabled={busy}><option>1024x1024</option><option>832x480</option><option>1280x720</option></select></label>
        {imageOperation === 'edit' && <label className="settings-field"><span>Reference image</span><input type="file" accept="image/*" onChange={(e) => void handleReferenceImageChange(e.target.files?.[0] ?? null)} disabled={busy} /></label>}
      </div>
      <div className="media-action-row">
        {imageOperation === 'generate' ? (
          <button className="btn-primary" onClick={() => void runImageGenerate()} disabled={busy || !prompt.trim() || !visualProviderReady || !selectedMediaModel?.functions.includes('image-generation')}>Generate image</button>
        ) : (
          <button className="btn-primary" onClick={() => void runImageEdit()} disabled={busy || !prompt.trim() || !referenceImage || !visualProviderReady || !selectedMediaModel?.functions.includes('image-editing')}>Edit image</button>
        )}
        {referenceImage && <button className="btn-secondary" onClick={() => setReferenceImage(null)} disabled={busy}>Remove reference</button>}
      </div>
      {artifact?.type === 'image' && <img className="media-result-image" src={artifact.url} alt={artifact.name} />}
      {artifact?.type === 'image' && <div className="media-artifact-meta">Saved artifact: {artifact.name}</div>}
      {error && <div className="settings-feedback error">{error}</div>}
    </div>
  );

  if (mode === 'voice') return (
    <div className="media-studio">
      <div className="media-studio-header">
        <div><span className="settings-kicker">MEDIA STUDIO · VOICE</span><h2>Push-to-talk voice</h2><p>ASR → Chat → TTS, with separate provider profiles.</p></div>
        <button className={recording ? 'btn-secondary recording-button' : 'btn-primary'} onClick={recording ? () => recorderRef.current?.stop() : () => void startRecording()} disabled={busy && !recording}>
          {recording ? 'Stop & transcribe' : 'Record'}
        </button>
      </div>
      <div className="media-control-grid">
        <label className="settings-field"><span>Language</span><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en-US" disabled={busy || recording} /></label>
        <label className="settings-field"><span>TTS voice override</span><input value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="Uses TTS profile voice" disabled={busy} /></label>
      </div>
      <section className="voice-transcript-card">
        <div className="settings-kicker">TRANSCRIPT</div>
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Recorded speech appears here…" disabled={busy} />
        <button className="btn-primary" onClick={() => void askAndSpeak()} disabled={busy || !transcript.trim() || !chatModelId}>Ask model & speak response</button>
      </section>
      {answer && <section className="voice-answer-card"><div className="settings-kicker">ASSISTANT</div><p>{answer}</p></section>}
      {error && <div className="settings-feedback error">{error}</div>}
    </div>
  );

  return (
    <div className="media-studio">
      <div className="media-studio-header">
        <div><span className="settings-kicker">MEDIA STUDIO · VIDEO</span><h2>Generate video</h2><p>Only video-capable NVIDIA models appear here. Hosted models need an endpoint-access key; self-hosted NIMs may run without an API key.</p></div>
        {!visualProviderReady && <button className="btn-primary" onClick={onOpenSettings}>Configure media</button>}
      </div>
      <section className="media-model-card"><label className="settings-field"><span>Model</span><select value={mediaModelId} onChange={(event) => void handleMediaModelChange(event.target.value)} disabled={busy}>{mediaModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.availability === "hosted" ? "Hosted" : "Self-hosted"}</option>)}</select></label>{selectedMediaModel && <div className="media-model-explainer"><strong>{selectedMediaModel.name}</strong><span>{selectedMediaModel.description}</span><span>Route: <code>{selectedMediaModel.defaultBaseUrl || "configure in Settings"}</code>{selectedMediaModel.endpoint}</span></div>}</section><label className="media-prompt-field"><span>Prompt</span><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the video…" disabled={busy} /></label>
      <div className="media-control-grid">
        <label className="settings-field"><span>Size</span><select value={videoSize} onChange={(e) => setVideoSize(e.target.value)} disabled={busy}><option>832x480</option><option>1280x720</option></select></label>
        <label className="settings-field"><span>Seconds</span><select value={videoSeconds} onChange={(e) => setVideoSeconds(Number(e.target.value))} disabled={busy}><option value={4}>4</option><option value={5}>5</option><option value={6}>6</option><option value={8}>8</option></select></label>
        <label className="settings-field"><span>Reference image</span><input type="file" accept="image/*" onChange={(e) => setVideoImage(e.target.files?.[0] ?? null)} disabled={busy} /></label>
      </div>
      <div className="media-action-row">
        <button className="btn-primary" onClick={() => void runVideo()} disabled={busy || !prompt.trim() || !visualProviderReady || !selectedMediaModel?.functions.includes('video-generation')}>Generate video</button>
        {videoImage && <button className="btn-secondary" onClick={() => setVideoImage(null)} disabled={busy}>Remove reference</button>}
      </div>
      {videoProgress && (
        <section className="media-job-status" aria-live="polite">
          <div className="media-job-status-head">
            <strong>{videoProgress.phase === 'submitting'
              ? 'Submitting video job…'
              : videoProgress.phase === 'queued'
              ? 'Video job queued'
              : videoProgress.phase === 'rendering'
              ? 'Rendering video'
              : videoProgress.phase === 'downloading'
              ? 'Downloading finished MP4'
              : 'Video ready'}</strong>
            {typeof videoProgress.progress === 'number' && videoProgress.phase !== 'downloading' && (
              <span>{Math.round(videoProgress.progress)}%</span>
            )}
          </div>
          {typeof videoProgress.progress === 'number' && videoProgress.phase !== 'downloading' && (
            <div className="media-job-progress-track" role="progressbar" aria-valuenow={Math.round(videoProgress.progress)} aria-valuemin={0} aria-valuemax={100}>
              <div className="media-job-progress-fill" style={{ width: Math.max(0, Math.min(100, videoProgress.progress)) + '%' }} />
            </div>
          )}
          {videoProgress.phase === 'downloading' && <div className="media-job-progress-indeterminate" />}
        </section>
      )}
      {artifact?.type === 'video' && <video className="media-result-video" src={artifact.url} controls playsInline />}
      {artifact?.type === 'video' && <div className="media-artifact-meta">Saved artifact: {artifact.name}</div>}
      {error && <div className="settings-feedback error">{error}</div>}
    </div>
  );
}

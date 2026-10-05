import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageEditRequest,
  ImageEditResponse,
  VideoGenerationRequest,
  VideoGenerationResponse,
  TranscriptionResponse,
  TTSRequest,
  NativeMultipartResponse,
} from '../types';
import { getMediaProviderConfig, type MediaProviderKind } from './mediaConfig';
import { getMediaModelDefinition } from './mediaCatalog';
import { APIError } from './api';
import { normalizeNvidiaApiKey } from './nvidiaConfig';

interface NimhubMediaHttpPlugin {
  postMultipart(options: {
    url: string;
    apiKey?: string;
    fields?: Record<string, string>;
    fileBase64?: string;
    fileFieldName?: string;
    fileName?: string;
    fileMimeType?: string;
    connectTimeout?: number;
    readTimeout?: number;
  }): Promise<NativeMultipartResponse>;
}

const NativeMediaHttp = registerPlugin<NimhubMediaHttpPlugin>('NimhubMediaHttp');

function assertNative(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('NIM Hub media transport is available only in the Android app');
  }
}

function joinEndpoint(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

async function requireProfile(kind: MediaProviderKind, options?: { allowKeyless?: boolean }) {
  const profile = await getMediaProviderConfig(kind);
  if (!profile.baseUrl) {
    throw new APIError(
      `No API base URL configured for ${kind.toUpperCase()}.`,
      'MEDIA_ENDPOINT_NOT_CONFIGURED',
      503,
      false,
      'nvidia',
    );
  }
  if (!profile.apiKey && !options?.allowKeyless) {
    throw new APIError(
      `No API key configured for ${kind.toUpperCase()}. Configure a dedicated media key or the Chat NVIDIA key.`,
      'MEDIA_NOT_CONFIGURED',
      503,
      false,
      'nvidia',
    );
  }
  return profile;
}

async function nativeJsonPost<T>(url: string, apiKey: string | null, body: unknown, timeout: number): Promise<T> {
  const response = await CapacitorHttp.request({
    url,
    method: 'POST',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${normalizeNvidiaApiKey(apiKey)}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    data: body,
    connectTimeout: 30000,
    readTimeout: timeout,
    responseType: 'json',
  });

  const data = response.data;
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
    const nested = detail.error && typeof detail.error === 'object' ? detail.error as Record<string, unknown> : {};
    const message = String(nested.message ?? detail.message ?? `NVIDIA media request failed: ${response.status}`);
    const code = response.status === 401 || response.status === 403
      ? 'NVIDIA_AUTH_FAILED'
      : response.status === 429 ? 'NVIDIA_RATE_LIMITED' : 'NVIDIA_MEDIA_REQUEST_FAILED';
    throw new APIError(
      response.status === 401 || response.status === 403 ? 'NVIDIA rejected the media API key' : message,
      code,
      response.status,
      response.status === 429 || response.status >= 500,
      'nvidia',
    );
  }
  return data as T;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read media data'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const bytes = atob(data);
  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) output[i] = bytes.charCodeAt(i);
  return new Blob([output], { type: mimeType });
}

function parseMultipartPayload(response: NativeMultipartResponse): unknown {
  const bytes = atob(response.data_base64);
  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) output[i] = bytes.charCodeAt(i);
  const text = new TextDecoder().decode(output);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertSuccess(response: NativeMultipartResponse, operation: string): void {
  if (response.status >= 200 && response.status < 300) return;
  const payload = parseMultipartPayload(response);
  const detail = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
  const nested = detail.error && typeof detail.error === 'object' ? detail.error as Record<string, unknown> : {};
  const message = String(nested.message ?? detail.message ?? `NVIDIA ${operation} failed: HTTP ${response.status}`);
  throw new APIError(
    response.status === 401 || response.status === 403 ? 'NVIDIA rejected the media API key' : message,
    response.status === 429 ? 'NVIDIA_RATE_LIMITED' : 'NVIDIA_MEDIA_REQUEST_FAILED',
    response.status,
    response.status === 429 || response.status >= 500,
    'nvidia',
  );
}

export interface MediaProviderProbe {
  ok: boolean;
  status: number;
  message: string;
  target: string;
}

export async function testMediaProvider(kind: MediaProviderKind): Promise<MediaProviderProbe> {
  assertNative();
  const profile = await getMediaProviderConfig(kind);
  if (!profile.baseUrl) {
    throw new APIError(
      `No API base URL configured for ${kind.toUpperCase()}.`,
      'MEDIA_ENDPOINT_NOT_CONFIGURED',
      503,
      false,
      'nvidia',
    );
  }

  const model = getMediaModelDefinition(profile.model);
  const selfHosted = model?.availability === 'self-hosted';
  const probePath = selfHosted ? '/health/ready' : '/models';
  const target = joinEndpoint(profile.baseUrl, probePath);

  const response = await CapacitorHttp.request({
    url: target,
    method: 'GET',
    headers: {
      ...(profile.apiKey ? { Authorization: `Bearer ${normalizeNvidiaApiKey(profile.apiKey)}` } : {}),
      Accept: 'application/json',
    },
    connectTimeout: 15000,
    readTimeout: 15000,
    responseType: 'json',
  });

  const data = response.data;
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
    const nested = detail.error && typeof detail.error === 'object' ? detail.error as Record<string, unknown> : {};
    const message = String(
      nested.message ??
      detail.message ??
      `Media endpoint probe failed: HTTP ${response.status}`,
    );
    throw new APIError(
      response.status === 401 || response.status === 403 ? 'Media endpoint rejected the configured API key' : message,
      response.status === 429 ? 'NVIDIA_RATE_LIMITED' : 'MEDIA_PROBE_FAILED',
      response.status,
      response.status === 429 || response.status >= 500,
      'nvidia',
    );
  }

  if (selfHosted) {
    return {
      ok: true,
      status: response.status,
      message: `${model?.name ?? 'NIM'} deployment is live and ready.`,
      target,
    };
  }

  return {
    ok: true,
    status: response.status,
    message: `NVIDIA hosted endpoint is reachable. The selected ${model?.name ?? 'model'} will be verified by the actual generation request.`,
    target,
  };
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  assertNative();
  const profile = await requireProfile('image', { allowKeyless: true });
  const model = getMediaModelDefinition(profile.model || request.model);
  if (model?.availability === 'hosted' && !profile.apiKey) {
    throw new APIError(
      'The selected hosted media endpoint needs an NVIDIA endpoint-access key. Add a dedicated media key or configure the Chat key.',
      'MEDIA_NOT_CONFIGURED',
      503,
      false,
      'nvidia',
    );
  }
  if (!model?.functions.includes('image-generation')) {
    throw new APIError('Selected image model does not support image generation.', 'MEDIA_MODEL_UNSUPPORTED', 400, false, 'nvidia');
  }

  if (model.transport === 'cosmos3') {
    const resolution = request.size === '832x480' ? '480_16_9'
      : request.size === '1280x720' ? '720_16_9'
      : '720_1_1';
    const payload = await nativeJsonPost<{ b64_image?: string }>(
      joinEndpoint(profile.baseUrl, model.endpoint),
      profile.apiKey,
      {
        model_mode: 'text2image',
        prompt: request.prompt,
        resolution,
        num_frames: 1,
        num_inference_steps: 50,
      },
      180000,
    );
    if (!payload.b64_image) {
      throw new APIError('Cosmos3 returned no image payload.', 'MEDIA_EMPTY_RESULT', 502, false, 'nvidia');
    }
    return { created: Math.floor(Date.now() / 1000), data: [{ b64_json: payload.b64_image }] };
  }

  return nativeJsonPost<ImageGenerationResponse>(
    joinEndpoint(profile.baseUrl, '/images/generations'),
    profile.apiKey,
    {
      model: profile.model || request.model,
      prompt: request.prompt,
      n: request.n ?? 1,
      size: request.size ?? '1024x1024',
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.style ? { style: request.style } : {}),
      response_format: request.response_format ?? 'b64_json',
    },
    180000,
  );
}

export async function editImage(request: ImageEditRequest): Promise<ImageEditResponse> {
  assertNative();
  const profile = await requireProfile('image', { allowKeyless: true });
  const response = await NativeMediaHttp.postMultipart({
    url: joinEndpoint(profile.baseUrl, '/images/edits'),
    apiKey: profile.apiKey,
    fields: {
      model: profile.model || request.model,
      prompt: request.prompt,
      n: String(request.n ?? 1),
      response_format: request.response_format ?? 'b64_json',
    },
    fileBase64: await blobToBase64(request.image),
    fileFieldName: 'image',
    fileName: request.fileName ?? 'image.png',
    fileMimeType: (request.mimeType ?? request.image.type) || 'image/png',
    connectTimeout: 30000,
    readTimeout: 180000,
  });
  assertSuccess(response, 'image edit');
  return parseMultipartPayload(response) as ImageEditResponse;
}

export async function transcribeAudio(
  audio: Blob,
  options?: { language?: string; wordTimeOffsets?: boolean; fileName?: string },
): Promise<string> {
  assertNative();
  const profile = await requireProfile('asr', { allowKeyless: true });
  const response = await NativeMediaHttp.postMultipart({
    url: joinEndpoint(profile.baseUrl, '/audio/transcriptions'),
    apiKey: profile.apiKey,
    fields: {
      ...(profile.model ? { model: profile.model } : {}),
      ...(options?.language ? { language: options.language } : {}),
      word_time_offsets: String(options?.wordTimeOffsets ?? false),
    },
    fileBase64: await blobToBase64(audio),
    fileName: options?.fileName ?? 'recording.webm',
    fileMimeType: audio.type || 'audio/webm',
    connectTimeout: 30000,
    readTimeout: 120000,
  });
  assertSuccess(response, 'ASR transcription');
  const payload = parseMultipartPayload(response) as TranscriptionResponse | Record<string, unknown>;
  const text = typeof payload === 'object' && payload !== null ? payload.text : payload;
  if (typeof text !== 'string' || !text.trim()) {
    throw new APIError('ASR returned no transcript', 'ASR_EMPTY_RESULT', 502, false, 'nvidia');
  }
  return text.trim();
}

export async function synthesizeSpeech(
  text: string,
  options?: Partial<TTSRequest>,
): Promise<{ audio: Blob; contentType: string }> {
  assertNative();
  const profile = await requireProfile('tts', { allowKeyless: true });
  const response = await NativeMediaHttp.postMultipart({
    url: joinEndpoint(profile.baseUrl, '/audio/synthesize'),
    apiKey: profile.apiKey!,
    fields: {
      language: options?.language ?? 'en-US',
      text: text.trim(),
      voice: options?.voice ?? profile.voice ?? 'Magpie-Multilingual.EN-US.Aria',
      ...(options?.sample_rate_hz ? { sample_rate_hz: String(options.sample_rate_hz) } : {}),
    },
    connectTimeout: 30000,
    readTimeout: 120000,
  });
  assertSuccess(response, 'TTS synthesis');
  return {
    audio: base64ToBlob(response.data_base64, response.contentType || 'audio/wav'),
    contentType: response.contentType || 'audio/wav',
  };
}

export async function generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
  assertNative();
  const profile = await requireProfile('video', { allowKeyless: true });
  const model = getMediaModelDefinition(profile.model || request.model);
  if (model?.availability === 'hosted' && !profile.apiKey) {
    throw new APIError(
      'The selected hosted media endpoint needs an NVIDIA endpoint-access key. Add a dedicated media key or configure the Chat key.',
      'MEDIA_NOT_CONFIGURED',
      503,
      false,
      'nvidia',
    );
  }
  if (!model?.functions.includes('video-generation')) {
    throw new APIError('Selected video model does not support video generation.', 'MEDIA_MODEL_UNSUPPORTED', 400, false, 'nvidia');
  }

  if (model.transport === 'cosmos3') {
    const seconds = request.seconds ?? 4;
    const modelMode = request.input_reference ? 'image2video' : 'text2video';
    const resolution = request.size === '1280x720' ? '720_16_9' : '480_16_9';
    const payload = await nativeJsonPost<{ b64_video?: string }>(
      joinEndpoint(profile.baseUrl, model.endpoint),
      profile.apiKey,
      {
        model_mode: modelMode,
        prompt: request.prompt,
        resolution,
        num_frames: Math.max(25, Math.min(197, Math.round(seconds * 24))),
        num_inference_steps: 35,
        fps: 24,
        ...(request.input_reference ? { input_reference: request.input_reference } : {}),
      },
      300000,
    );
    if (!payload.b64_video) {
      throw new APIError('Cosmos3 returned no video payload.', 'MEDIA_EMPTY_RESULT', 502, false, 'nvidia');
    }
    return { created: Math.floor(Date.now() / 1000), status: 'completed', data: { b64_json: payload.b64_video } };
  }

  return nativeJsonPost<VideoGenerationResponse>(
    joinEndpoint(profile.baseUrl, '/videos/generations'),
    profile.apiKey!,
    {
      model: profile.model || request.model,
      prompt: request.prompt,
      size: request.size ?? '832x480',
      seconds: request.seconds ?? 4,
      ...(request.input_reference ? { input_reference: request.input_reference } : {}),
    },
    300000,
  );
}

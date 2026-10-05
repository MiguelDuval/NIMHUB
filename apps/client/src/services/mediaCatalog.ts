/**
 * Explicit NVIDIA media catalog for Image and Video Studio.
 * The normal Chat /v1/models response is not treated as a visual catalog.
 */
export type MediaCatalogKind = 'image' | 'video' | 'asr' | 'tts';
export type MediaFunction = 'image-generation' | 'image-editing' | 'video-generation' | 'asr' | 'tts';
export type MediaTransport = 'cosmos3' | 'openai-image' | 'openai-video' | 'speech';
export type MediaAvailability = 'hosted' | 'self-hosted';

export interface MediaModelDefinition {
  id: string;
  name: string;
  kinds: MediaCatalogKind[];
  functions: MediaFunction[];
  transport: MediaTransport;
  availability: MediaAvailability;
  defaultBaseUrl: string;
  endpoint: string;
  description: string;
  credentialNote: string;
}

export const MEDIA_MODEL_CATALOG: MediaModelDefinition[] = [
  {
    id: 'nvidia/cosmos3-nano',
    name: 'Cosmos3 Nano',
    kinds: ['image', 'video'],
    functions: ['image-generation', 'video-generation'],
    transport: 'cosmos3',
    availability: 'hosted',
    defaultBaseUrl: 'https://ai.api.nvidia.com/v1',
    endpoint: '/cosmos/nvidia/cosmos3-nano',
    description: 'Unified NVIDIA visual generator: text→image, text→video and image→video.',
    credentialNote: 'Uses the NVIDIA API key that has access to the hosted Cosmos3 endpoint.',
  },
  {
    id: 'qwen/qwen-image-2512',
    name: 'Qwen-Image 2512',
    kinds: ['image'],
    functions: ['image-generation'],
    transport: 'openai-image',
    availability: 'self-hosted',
    defaultBaseUrl: '',
    endpoint: '/images/generations',
    description: 'Image generation NIM. Deploy it, then enter the invocation/base URL of that deployment.',
    credentialNote: 'Use the key and URL belonging to the target NIM deployment.'
  },
  {
    id: 'qwen/qwen-image-edit-2511',
    name: 'Qwen Image Edit 2511',
    kinds: ['image'],
    functions: ['image-editing'],
    transport: 'openai-image',
    availability: 'self-hosted',
    defaultBaseUrl: '',
    endpoint: '/images/edits',
    description: 'Image editing NIM for reference-image workflows. Use the deployed Qwen Image Edit variant.',
    credentialNote: 'Use the key and URL belonging to the target NIM deployment.',
  },
  {
    id: 'wan-ai/wan2.2',
    name: 'Wan2.2',
    kinds: ['video'],
    functions: ['video-generation'],
    transport: 'openai-video',
    availability: 'self-hosted',
    defaultBaseUrl: '',
    endpoint: '/videos',
    description: 'NVIDIA Visual GenAI video NIM. The deployment is configured as t2v or i2v; NIM Hub uses its job-based lifecycle for either workflow.',
    credentialNote: 'Use the invocation/base URL of the deployed Wan2.2 NIM.',
  },
];

export function getMediaModelsForKind(kind: MediaCatalogKind): MediaModelDefinition[] {
  return MEDIA_MODEL_CATALOG.filter((model) => model.kinds.includes(kind));
}

export function getMediaModelDefinition(modelId: string | undefined | null): MediaModelDefinition | undefined {
  if (!modelId) return undefined;
  return MEDIA_MODEL_CATALOG.find((model) => model.id === modelId);
}

export function defaultMediaModel(kind: 'image' | 'video'): MediaModelDefinition {
  const model = MEDIA_MODEL_CATALOG.find(
    (item) => item.kinds.includes(kind) && item.availability === 'hosted',
  ) ?? getMediaModelsForKind(kind)[0];
  if (!model) throw new Error('No media model registered for ' + kind);
  return model;
}

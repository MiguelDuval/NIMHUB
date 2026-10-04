/**
 * Model capability inference utilities
 */

import type { ModelCapabilityInfo, NIMModel, ModelCapability, ModelModality } from '../types';

export function transformModels(models: NIMModel[]): ModelCapabilityInfo[] {
  const now = new Date().toISOString();

  return models.map((model) => {
    const id = model.id.toLowerCase();
    const capabilities = inferCapabilities(id);
    const endpointFamily = inferEndpointFamily(id, capabilities);
    const { inputModalities, outputModalities } = inferModalities(capabilities);

    return {
      id: model.id,
      name: model.id,
      provider: 'nvidia',
      endpointFamily,
      inputModalities,
      outputModalities,
      capabilities,
      discoveredAt: now,
      contextWindow: inferContextWindow(id),
    };
  });
}

function inferCapabilities(modelId: string): ModelCapability[] {
  const caps: ModelCapability[] = ['chat'];
  const id = modelId.toLowerCase();

  // Reasoning models
  if (id.includes('reasoning') || id.includes('r1') || id.includes('nemotron')) {
    caps.push('reasoning');
  }

  // Vision models
  if (
    id.includes('vision') ||
    id.includes('vlm') ||
    id.includes('llava') ||
    id.includes('qwen-vl') ||
    id.includes('pixtral')
  ) {
    caps.push('vision');
  }

  // Tool calling - most modern models support this
  if (!id.includes('instruct') || id.includes('nemotron') || id.includes('llama-3')) {
    caps.push('tool-calling');
  }

  // Image generation
  if (id.includes('flux') || id.includes('stable-diffusion') || id.includes('sdxl') || id.includes('qwen-image')) {
    caps.push('image-generation');
  }

  // Video generation
  if (id.includes('video') || id.includes('svd') || id.includes('stable-video')) {
    caps.push('video-generation');
  }

  // ASR/TTS
  if (id.includes('asr') || id.includes('whisper') || id.includes('speech-to-text')) {
    caps.push('asr');
  }
  if (id.includes('tts') || id.includes('text-to-speech') || id.includes('parakeet')) {
    caps.push('tts');
  }

  return caps;
}

function inferEndpointFamily(modelId: string, capabilities: ModelCapability[]): ModelCapabilityInfo['endpointFamily'] {
  const id = modelId.toLowerCase();

  if (capabilities.includes('image-generation')) return 'image';
  if (capabilities.includes('video-generation')) return 'video';
  if (capabilities.includes('asr') || capabilities.includes('tts')) return 'speech';
  return 'chat';
}

function inferModalities(capabilities: ModelCapability[]): { inputModalities: ModelModality[]; outputModalities: ModelModality[] } {
  const input: ModelModality[] = ['text'];
  const output: ModelModality[] = ['text'];

  if (capabilities.includes('vision')) {
    input.push('image');
  }
  if (capabilities.includes('image-generation')) {
    output.push('image');
  }
  if (capabilities.includes('video-generation')) {
    output.push('video');
  }
  if (capabilities.includes('asr')) {
    input.push('audio');
  }
  if (capabilities.includes('tts')) {
    output.push('audio');
  }

  return { inputModalities: input, outputModalities: output };
}

function inferContextWindow(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  if (id.includes('32k') || id.includes('128k')) return 128000;
  if (id.includes('8k')) return 8192;
  if (id.includes('4k')) return 4096;
  // Default for modern models
  if (id.includes('llama-3') || id.includes('nemotron') || id.includes('mistral')) return 8192;
  return undefined;
}
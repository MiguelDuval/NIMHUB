import { describe, expect, it } from 'vitest';
import { defaultMediaModel, getMediaModelDefinition, getMediaModelsForKind } from './mediaCatalog';

describe('curated NVIDIA media catalog', () => {
  it('limits Image Studio to image-capable models', () => {
    expect(getMediaModelsForKind('image').map((model) => model.id)).toEqual([
      'nvidia/cosmos3-nano', 'qwen/qwen-image-2512', 'qwen/qwen-image-edit-2511',
    ]);
  });

  it('limits Video Studio to video-capable models', () => {
    expect(getMediaModelsForKind('video').map((model) => model.id)).toEqual([
      'nvidia/cosmos3-nano', 'wan-ai/wan2.2',
    ]);
  });

  it('uses the async video job endpoint for Wan2.2', () => {
    expect(getMediaModelDefinition('wan-ai/wan2.2')?.endpoint).toBe('/videos');
    expect(getMediaModelDefinition('wan-ai/wan2.2')?.probeStrategy).toBe('health-ready');
    expect(getMediaModelDefinition('wan-ai/wan2.2')?.credentialPolicy).toBe('primary-or-dedicated');
  });

  it('uses a non-generating validation probe for hosted Cosmos3', () => {
    const model = getMediaModelDefinition('nvidia/cosmos3-nano');
    expect(model?.endpoint).toBe('/cosmos/nvidia/cosmos3-nano');
    expect(model?.probeStrategy).toBe('cosmos-validation');
    expect(model?.defaultBaseUrl).toBe('https://ai.api.nvidia.com/v1');
    expect(model?.credentialPolicy).toBe('endpoint-key');
  });

  it('uses Cosmos3 as the first hosted model for image and video', () => {
    expect(defaultMediaModel('image').id).toBe('nvidia/cosmos3-nano');
    expect(defaultMediaModel('video').id).toBe('nvidia/cosmos3-nano');
    expect(getMediaModelDefinition('nvidia/cosmos3-nano')?.functions).toEqual([
      'image-generation', 'video-generation',
    ]);
  });
});

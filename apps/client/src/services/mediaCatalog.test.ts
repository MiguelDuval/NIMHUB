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
  });

  it('uses Cosmos3 as the first hosted model for image and video', () => {
    expect(defaultMediaModel('image').id).toBe('nvidia/cosmos3-nano');
    expect(defaultMediaModel('video').id).toBe('nvidia/cosmos3-nano');
    expect(getMediaModelDefinition('nvidia/cosmos3-nano')?.functions).toEqual([
      'image-generation', 'video-generation',
    ]);
  });
});

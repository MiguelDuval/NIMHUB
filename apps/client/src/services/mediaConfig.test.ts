import { describe, expect, it } from 'vitest';
import { getMediaProviderDefaults } from './mediaConfig';

describe('media provider profiles', () => {
  it('keeps distinct defaults for each media family', () => {
    expect(getMediaProviderDefaults('image').model).toContain('qwen');
    expect(getMediaProviderDefaults('video').model).toContain('wan');
    expect(getMediaProviderDefaults('asr').model).toContain('parakeet');
    expect(getMediaProviderDefaults('tts').model).toContain('magpie');
  });

  it('provides the documented default TTS voice hint', () => {
    expect(getMediaProviderDefaults('tts').voice).toBe('Magpie-Multilingual.EN-US.Aria');
  });
});

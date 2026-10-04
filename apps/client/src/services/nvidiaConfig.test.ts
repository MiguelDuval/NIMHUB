import { describe, expect, it } from 'vitest';

import { normalizeNvidiaApiKey } from './nvidiaConfig';

describe('normalizeNvidiaApiKey', () => {
  it('keeps a canonical NVIDIA API key unchanged', () => {
    expect(normalizeNvidiaApiKey('nvapi-abc123')).toBe('nvapi-abc123');
  });

  it('accepts the common NVAPI label format', () => {
    expect(normalizeNvidiaApiKey('NVAPI nvapi-abc123')).toBe('nvapi-abc123');
  });

  it('accepts the copied "NVAPI - ..." format', () => {
    expect(normalizeNvidiaApiKey('NVAPI - nvapi-abc123')).toBe('nvapi-abc123');
  });

  it('accepts a Bearer-prefixed token', () => {
    expect(normalizeNvidiaApiKey('Bearer nvapi-abc123')).toBe('nvapi-abc123');
  });

  it('rejects an empty or non-NVIDIA key', () => {
    expect(() => normalizeNvidiaApiKey('')).toThrow('NVIDIA API key is required');
    expect(() => normalizeNvidiaApiKey('some-other-token')).toThrow(
      'NVIDIA API key must start with nvapi-',
    );
  });
});

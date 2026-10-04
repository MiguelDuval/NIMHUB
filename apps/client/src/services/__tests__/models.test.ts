import { describe, it, expect } from 'vitest';
import type { ModelCapabilityInfo, ModelCapability } from '../../types';
import {
  filterModelsByCapability,
  getChatModels,
  getVisionModels,
  getToolCallingModels,
  getReasoningModels,
  modelSupports,
  getCapabilitySource,
  isVerifiedModel,
  getModelDisplayName,
  getContextWindowDisplay,
  sortModels,
  transformModels,
} from '../models';

const mockModels: ModelCapabilityInfo[] = [
  {
    id: 'nvidia/nemotron-3-ultra',
    name: 'Nemotron 3 Ultra',
    provider: 'nvidia',
    endpointFamily: 'chat',
    inputModalities: ['text'],
    outputModalities: ['text'],
    capabilities: ['chat', 'reasoning', 'tool-calling'],
    discoveredAt: '2024-01-01T00:00:00Z',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilitySource: 'registry',
  },
  {
    id: 'meta/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B',
    provider: 'nvidia',
    endpointFamily: 'chat',
    inputModalities: ['text'],
    outputModalities: ['text'],
    capabilities: ['chat', 'tool-calling'],
    discoveredAt: '2024-01-01T00:00:00Z',
    contextWindow: 131072,
    maxOutputTokens: 4096,
    capabilitySource: 'registry',
  },
  {
    id: 'nvidia/nv-vision',
    name: 'NV-Vision',
    provider: 'nvidia',
    endpointFamily: 'chat',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    capabilities: ['chat', 'vision'],
    discoveredAt: '2024-01-01T00:00:00Z',
    contextWindow: 4096,
    capabilitySource: 'registry',
  },
  {
    id: 'unknown/model',
    name: 'Unknown Model',
    provider: 'nvidia',
    endpointFamily: 'chat',
    inputModalities: ['text'],
    outputModalities: ['text'],
    capabilities: ['chat', 'vision'],
    discoveredAt: '2024-01-01T00:00:00Z',
    capabilitySource: 'heuristic',
  },
];

describe('Model utilities', () => {
  describe('filterModelsByCapability', () => {
    it('filters models by vision capability', () => {
      const result = filterModelsByCapability(mockModels, 'vision');
      expect(result).toHaveLength(2);
      expect(result.every((m) => m.capabilities.includes('vision'))).toBe(true);
    });

    it('filters models by reasoning capability', () => {
      const result = filterModelsByCapability(mockModels, 'reasoning');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('nvidia/nemotron-3-ultra');
    });

    it('returns empty array for non-existent capability', () => {
      const result = filterModelsByCapability(mockModels, 'image-generation');
      expect(result).toHaveLength(0);
    });
  });

  describe('getChatModels', () => {
    it('returns only chat models', () => {
      const result = getChatModels(mockModels);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((m) => m.capabilities.includes('chat') && m.endpointFamily === 'chat')).toBe(true);
    });
  });

  describe('getVisionModels', () => {
    it('returns only vision models', () => {
      const result = getVisionModels(mockModels);
      expect(result.length).toBe(2);
      expect(result.every((m) => m.capabilities.includes('vision'))).toBe(true);
    });
  });

  describe('getToolCallingModels', () => {
    it('returns only tool-calling models', () => {
      const result = getToolCallingModels(mockModels);
      expect(result.length).toBe(2);
      expect(result.every((m) => m.capabilities.includes('tool-calling'))).toBe(true);
    });
  });

  describe('getReasoningModels', () => {
    it('returns only reasoning models', () => {
      const result = getReasoningModels(mockModels);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('nvidia/nemotron-3-ultra');
    });
  });

  describe('modelSupports', () => {
    it('returns true when model has capability', () => {
      const model = mockModels[0];
      expect(modelSupports(model, 'reasoning')).toBe(true);
      expect(modelSupports(model, 'chat')).toBe(true);
    });

    it('returns false when model lacks capability', () => {
      const model = mockModels[1];
      expect(modelSupports(model, 'reasoning')).toBe(false);
      expect(modelSupports(model, 'vision')).toBe(false);
    });
  });

  describe('getCapabilitySource', () => {
    it('returns registry for verified models', () => {
      expect(getCapabilitySource(mockModels[0])).toBe('registry');
    });

    it('returns heuristic for unverified models', () => {
      expect(getCapabilitySource(mockModels[3])).toBe('heuristic');
    });
  });

  describe('isVerifiedModel', () => {
    it('returns true for registry models', () => {
      expect(isVerifiedModel(mockModels[0])).toBe(true);
    });

    it('returns false for heuristic models', () => {
      expect(isVerifiedModel(mockModels[3])).toBe(false);
    });
  });

  describe('getModelDisplayName', () => {
    it('returns name when available', () => {
      expect(getModelDisplayName(mockModels[0])).toBe('Nemotron 3 Ultra');
    });

    it('returns id when name is missing', () => {
      const model: ModelCapabilityInfo = {
        ...mockModels[0],
        name: undefined,
      };
      expect(getModelDisplayName(model)).toBe('nvidia/nemotron-3-ultra');
    });
  });

  describe('getContextWindowDisplay', () => {
    it('formats context window in k', () => {
      expect(getContextWindowDisplay(mockModels[0])).toBe('8k');
      expect(getContextWindowDisplay(mockModels[1])).toBe('128k');
    });

    it('returns Unknown for missing context window', () => {
      const model = mockModels[3];
      expect(getContextWindowDisplay(model)).toBe('Unknown');
    });
  });

  describe('sortModels', () => {
    it('puts registry models first', () => {
      const sorted = sortModels(mockModels);
      expect(isVerifiedModel(sorted[0])).toBe(true);
      expect(isVerifiedModel(sorted[1])).toBe(true);
      expect(isVerifiedModel(sorted[sorted.length - 1])).toBe(false);
    });
  });

  describe('transformModels', () => {
    it('ensures required fields have defaults', () => {
      const input = mockModels.map((m) => ({
        ...m,
        capabilities: undefined,
        inputModalities: undefined,
        outputModalities: undefined,
        endpointFamily: undefined,
        capabilitySource: undefined,
        discoveredAt: undefined,
      })) as unknown as ModelCapabilityInfo[];

      const result = transformModels(input);
      expect(result[0].capabilities).toEqual(['chat']);
      expect(result[0].inputModalities).toEqual(['text']);
      expect(result[0].outputModalities).toEqual(['text']);
      expect(result[0].endpointFamily).toBe('chat');
      expect(result[0].capabilitySource).toBe('heuristic');
      expect(result[0].discoveredAt).toBeDefined();
    });
  });
});

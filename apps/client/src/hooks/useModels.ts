/**
 * Models Hook - Model Discovery and Capability Management
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import type { ModelCapabilityInfo, ModelCapability } from '../types';

export function useModels() {
  const [models, setModels] = useState<ModelCapabilityInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const modelList = await api.listModels();
      setModels(modelList);
      // Auto-select first chat-capable model
      const chatModel = modelList.find((m) => m.capabilities.includes('chat'));
      if (chatModel && !selectedModelId) {
        setSelectedModelId(chatModel.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load models'));
    } finally {
      setLoading(false);
    }
  }, [selectedModelId]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const selectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
  }, []);

  const getModel = useCallback(
    (modelId: string): ModelCapabilityInfo | undefined => {
      return models.find((m) => m.id === modelId);
    },
    [models]
  );

  const getModelsByCapability = useCallback(
    (capability: ModelCapability): ModelCapabilityInfo[] => {
      return models.filter((m) => m.capabilities.includes(capability));
    },
    [models]
  );

  const getModelsByEndpointFamily = useCallback(
    (family: ModelCapabilityInfo['endpointFamily']): ModelCapabilityInfo[] => {
      return models.filter((m) => m.endpointFamily === family);
    },
    [models]
  );

  const supportsVision = useCallback(
    (modelId: string): boolean => {
      const model = getModel(modelId);
      return model?.capabilities.includes('vision') ?? false;
    },
    [getModel]
  );

  const supportsToolCalling = useCallback(
    (modelId: string): boolean => {
      const model = getModel(modelId);
      return model?.capabilities.includes('tool-calling') ?? false;
    },
    [getModel]
  );

  const supportsReasoning = useCallback(
    (modelId: string): boolean => {
      const model = getModel(modelId);
      return model?.capabilities.includes('reasoning') ?? false;
    },
    [getModel]
  );

  return {
    models,
    selectedModelId,
    loading,
    error,
    loadModels,
    selectModel,
    getModel,
    getModelsByCapability,
    getModelsByEndpointFamily,
    supportsVision,
    supportsToolCalling,
    supportsReasoning,
  };
}
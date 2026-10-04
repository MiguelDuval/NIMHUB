/**
 * Model capability utilities - now works with pre-normalized gateway responses
 */

import type { ModelCapabilityInfo, ModelCapability, ModelModality, CapabilitySource, EndpointFamily } from '../types';

/**
 * Transform gateway's normalized model list to client ModelCapabilityInfo
 * Gateway now returns pre-normalized models with capability info
 */
export function transformModels(models: ModelCapabilityInfo[]): ModelCapabilityInfo[] {
  // Gateway already provides normalized models, just ensure required fields
  return models.map((model) => ({
    ...model,
    // Ensure required fields have defaults
    capabilities: model.capabilities ?? ['chat'],
    inputModalities: model.inputModalities ?? ['text'],
    outputModalities: model.outputModalities ?? ['text'],
    endpointFamily: model.endpointFamily ?? 'chat',
    capabilitySource: model.capabilitySource ?? 'heuristic',
    discoveredAt: model.discoveredAt ?? new Date().toISOString(),
  }));
}

/**
 * Filter models by capability
 */
export function filterModelsByCapability(
  models: ModelCapabilityInfo[],
  capability: ModelCapability
): ModelCapabilityInfo[] {
  return models.filter((m) => m.capabilities.includes(capability));
}

/**
 * Get models suitable for text chat
 */
export function getChatModels(models: ModelCapabilityInfo[]): ModelCapabilityInfo[] {
  return models.filter((m) => m.capabilities.includes('chat') && m.endpointFamily === 'chat');
}

/**
 * Get models that support vision
 */
export function getVisionModels(models: ModelCapabilityInfo[]): ModelCapabilityInfo[] {
  return models.filter((m) => m.capabilities.includes('vision'));
}

/**
 * Get models that support tool calling
 */
export function getToolCallingModels(models: ModelCapabilityInfo[]): ModelCapabilityInfo[] {
  return models.filter((m) => m.capabilities.includes('tool-calling'));
}

/**
 * Get models that support reasoning
 */
export function getReasoningModels(models: ModelCapabilityInfo[]): ModelCapabilityInfo[] {
  return models.filter((m) => m.capabilities.includes('reasoning'));
}

/**
 * Check if a model supports a specific capability
 */
export function modelSupports(model: ModelCapabilityInfo, capability: ModelCapability): boolean {
  return model.capabilities.includes(capability);
}

/**
 * Get model's capability source (registry/heuristic/provider)
 */
export function getCapabilitySource(model: ModelCapabilityInfo): CapabilitySource {
  return model.capabilitySource ?? 'heuristic';
}

/**
 * Check if model capabilities are from verified registry
 */
export function isVerifiedModel(model: ModelCapabilityInfo): boolean {
  return model.capabilitySource === 'registry';
}

/**
 * Get model display name with capability badges
 */
export function getModelDisplayName(model: ModelCapabilityInfo): string {
  return model.name ?? model.id;
}

/**
 * Get context window in human-readable format
 */
export function getContextWindowDisplay(model: ModelCapabilityInfo): string {
  if (!model.contextWindow) return 'Unknown';
  const k = model.contextWindow / 1000;
  return k >= 100 ? `${(k / 1000).toFixed(0)}M` : `${k.toFixed(0)}k`;
}

/**
 * Sort models: registry first, then by name
 */
export function sortModels(models: ModelCapabilityInfo[]): ModelCapabilityInfo[] {
  return [...models].sort((a, b) => {
    // Registry models first
    const aRegistry = isVerifiedModel(a) ? 0 : 1;
    const bRegistry = isVerifiedModel(b) ? 0 : 1;
    if (aRegistry !== bRegistry) return aRegistry - bRegistry;
    // Then by name
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });
}
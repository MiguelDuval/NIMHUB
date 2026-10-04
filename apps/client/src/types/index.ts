/**
 * Core type definitions for NIM Hub
 * Shared between client and gateway where applicable
 */

// ============================================================================
// Model & Capability Types
// ============================================================================

export type ModelModality =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'text-to-speech'
  | 'speech-to-text';

export type ModelCapability =
  | 'chat'
  | 'reasoning'
  | 'vision'
  | 'tool-calling'
  | 'image-generation'
  | 'video-generation'
  | 'asr'
  | 'tts';

export type CapabilitySource = 'registry' | 'heuristic' | 'provider';

export type EndpointFamily = 'chat' | 'image' | 'video' | 'speech' | 'embedding';

export interface ModelCapabilityInfo {
  id: string;
  name?: string;
  provider: string;
  endpointFamily: EndpointFamily;
  inputModalities: ModelModality[];
  outputModalities: ModelModality[];
  capabilities: ModelCapability[];
  discoveredAt: string;
  maxTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilitySource: CapabilitySource;
}

export interface NIMModelListResponse {
  object: 'list';
  data: ModelCapabilityInfo[];
}

// Re-export all other types
export * from './chat';
export * from './api';
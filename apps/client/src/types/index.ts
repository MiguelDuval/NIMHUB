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

export interface ModelCapabilityInfo {
  id: string;
  name?: string;
  provider: string;
  endpointFamily: 'chat' | 'image' | 'video' | 'speech' | 'embedding';
  inputModalities: ModelModality[];
  outputModalities: ModelModality[];
  capabilities: ModelCapability[];
  discoveredAt: string;
  maxTokens?: number;
  contextWindow?: number;
}

export interface NIMModelListResponse {
  object: 'list';
  data: NIMModel[];
}

export interface NIMModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  root?: string;
  parent?: string;
  permission?: unknown[];
}

// Re-export all other types
export * from './chat';
export * from './api';
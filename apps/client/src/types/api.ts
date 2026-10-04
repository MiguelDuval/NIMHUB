/**
 * API, Request state, and error types
 */

import type { ModelCapabilityInfo } from './index';

export type RequestStatus = 'idle' | 'pending' | 'streaming' | 'success' | 'error' | 'cancelled';

// Gateway returns normalized models directly
export interface NIMModelListResponse {
  object: 'list';
  data: ModelCapabilityInfo[];
}

export interface APIError {
  code: string;
  message: string;
  provider?: string;
  retryable: boolean;
  requestId?: string;
  jobId?: string;
}

export interface RequestState<T = unknown> {
  status: RequestStatus;
  data?: T;
  error?: APIError;
  abortController?: AbortController;
}

// ============================================================================
// Vision / Image Types
// ============================================================================

export interface ImageAttachment {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  response_format?: 'url' | 'b64_json';
}

export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

// ============================================================================
// Job / Async Types (for video, long-running)
// ============================================================================

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job<T = unknown> {
  id: string;
  type: string;
  status: JobStatus;
  progress?: number;
  input: T;
  output?: unknown;
  error?: APIError;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ============================================================================
// Gateway Configuration
// ============================================================================

export interface GatewayConfig {
  baseUrl: string;
  nvidiaConfigured: boolean;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  nvidia_configured: boolean;
}
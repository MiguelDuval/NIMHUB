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
  nvidia_base_url?: string;
  admin_configured?: boolean;
  mcp_servers_configured?: number;
}

export interface NvidiaSettingsInput {
  apiKey: string;
  baseUrl: string;
}

export interface NvidiaSettingsResponse {
  ok: boolean;
  nvidia_configured: boolean;
  nvidia_base_url: string;
  models_available: number;
}

// ============================================================================
// MCP / Agent Types
// ============================================================================

export type MCPPermission = 'read' | 'write' | 'destructive';

export interface MCPServerSummary {
  id: string;
  transport: 'streamable_http' | 'stdio';
  enabled: boolean;
  permission: MCPPermission;
  configured: boolean;
}

export interface MCPToolSummary {
  server_id: string;
  name: string;
  qualified_name: string;
  model_name: string;
  description?: string | null;
  read_only?: boolean | null;
  destructive?: boolean | null;
  idempotent?: boolean | null;
  open_world?: boolean | null;
  permission: MCPPermission;
  requires_approval: boolean;
}

export interface MCPToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
  approval_grants?: MCPApprovalGrant[];
}

export interface MCPApprovalGrant {
  approval_token: string;
  arguments_sha256: string;
}

export interface MCPToolResult {
  tool: string;
  is_error: boolean;
  content: Array<Record<string, unknown>>;
  structured_content?: unknown;
  arguments_sha256: string;
}

export type AgentStatus = 'completed' | 'approval_required' | 'max_turns' | 'error';

export interface AgentApprovalRequest {
  tool: string;
  tool_call_id: string;
  model_name: string;
  description?: string | null;
  arguments: Record<string, unknown>;
  arguments_sha256: string;
  approval_token: string;
  destructive?: boolean | null;
  permission: MCPPermission;
}

export interface AgentRunRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream?: boolean;
  temperature?: number | null;
  tool_choice?: string | Record<string, unknown> | null;
  max_turns?: number;
  approval_grants?: MCPApprovalGrant[];
}

export interface AgentRunResponse {
  status: AgentStatus;
  response?: Record<string, unknown> | null;
  messages: Array<Record<string, unknown>>;
  approvals: AgentApprovalRequest[];
  turns: number;
}

export interface AgentStreamEvent {
  type: 'content_delta' | 'tool_result' | 'tool_error' | 'approval_required' | 'continue' | 'done' | 'max_turns' | 'error';
  text?: string;
  tool?: string;
  is_error?: boolean;
  turn?: number;
  tool_call_id?: string;
  message?: string;
  code?: string;
  approvals?: AgentApprovalRequest[];
  response?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  turns?: number;
}

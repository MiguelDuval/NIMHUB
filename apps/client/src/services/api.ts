/**
 * API Service Layer
 * Handles all communication with the NIM Hub Gateway
 */

import type {
  ModelCapabilityInfo,
  NIMModelListResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  HealthResponse,
  MCPServerSummary,
  MCPToolSummary,
  MCPToolCallRequest,
  MCPToolResult,
  AgentRunRequest,
  AgentRunResponse,
  AgentStreamEvent,
} from '../types';
import { transformModels } from './models';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';

export class APIError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly provider?: string;
  public readonly requestId?: string;
  public readonly status: number;

  constructor(
    message: string,
    code: string,
    status: number,
    retryable: boolean,
    provider?: string,
    requestId?: string
  ) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.retryable = retryable;
    this.provider = provider;
    this.requestId = requestId;
    this.status = status;
  }

  static fromResponse(response: Response, data: unknown): APIError {
    const detail = data as Record<string, unknown> | undefined;
    return new APIError(
      (detail?.message as string) ?? `Request failed: ${response.status}`,
      (detail?.code as string) ?? 'UNKNOWN_ERROR',
      response.status,
      (detail?.retryable as boolean) ?? response.status >= 500,
      detail?.provider as string | undefined,
      detail?.requestId as string | undefined
    );
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Gateway wraps errors in { detail: { code, message, retryable } }
    const errorData = (data as Record<string, unknown>)?.detail ?? data;
    throw APIError.fromResponse(response, errorData);
  }
  return data as T;
}

export const api = {
  /**
   * Health check endpoint
   */
  async health(): Promise<HealthResponse> {
    const response = await fetch(`${GATEWAY_URL}/api/health`);
    return handleResponse<HealthResponse>(response);
  },

  /**
   * List available models from NVIDIA NIM
   */
  async listModels(): Promise<ModelCapabilityInfo[]> {
    const response = await fetch(`${GATEWAY_URL}/api/models`);
    const data = await handleResponse<NIMModelListResponse>(response);
    return transformModels(data.data);
  },

  /**
   * Non-streaming chat completion
   */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(`${GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    });
    return handleResponse<ChatCompletionResponse>(response);
  },

  /**
   * Streaming chat completion using SSE
   */
  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const response = await fetch(`${GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      // Gateway wraps errors in { detail: { code, message, retryable } }
      const errorData = (data as Record<string, unknown>)?.detail ?? data;
      throw APIError.fromResponse(response, errorData);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              yield chunk;
            } catch {
              // Ignore parse errors for malformed chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * List sanitized MCP server metadata.
   */
  async listMCPServers(): Promise<MCPServerSummary[]> {
    const response = await fetch(`${GATEWAY_URL}/api/mcp/servers`);
    const data = await handleResponse<{ servers: MCPServerSummary[] }>(response);
    return data.servers;
  },

  /**
   * Discover sanitized MCP tool metadata.
   */
  async listMCPTools(): Promise<MCPToolSummary[]> {
    const response = await fetch(`${GATEWAY_URL}/api/mcp/tools`);
    const data = await handleResponse<{ tools: MCPToolSummary[] }>(response);
    return data.tools;
  },

  /**
   * Call one MCP tool through the gateway permission boundary.
   */
  async callMCPTool(request: MCPToolCallRequest): Promise<MCPToolResult> {
    const response = await fetch(`${GATEWAY_URL}/api/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return handleResponse<MCPToolResult>(response);
  },

  /**
   * Run the gateway-owned model/MCP loop without streaming.
   */
  async agent(request: AgentRunRequest): Promise<AgentRunResponse> {
    const response = await fetch(`${GATEWAY_URL}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    });
    return handleResponse<AgentRunResponse>(response);
  },

  /**
   * Stream gateway agent events over SSE.
   * An optional AbortSignal lets the client cancel the network request without
   * affecting the gateway's approval semantics or persisting any credentials.
   */
  async *agentStream(
    request: AgentRunRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    const response = await fetch(`${GATEWAY_URL}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
      signal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const errorData = (data as Record<string, unknown>)?.detail ?? data;
      throw APIError.fromResponse(response, errorData);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;
          try {
            yield JSON.parse(data) as AgentStreamEvent;
          } catch {
            // Ignore malformed SSE payloads; the next event can still recover.
          }
        }
      }

      // Handle a final SSE event even when the server closes without an extra
      // newline after the frame. This keeps the parser correct for proxies and
      // alternate SSE implementations, not just the current gateway.
      const finalLine = buffer.trim();
      if (finalLine.startsWith('data: ')) {
        const data = finalLine.slice(6).trim();
        if (data && data !== '[DONE]') {
          try {
            yield JSON.parse(data) as AgentStreamEvent;
          } catch {
            // Ignore a malformed terminal payload.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};

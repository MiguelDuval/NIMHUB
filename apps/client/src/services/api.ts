/**
 * API Service Layer
 * Handles all communication with the NIM Hub Gateway
 */

import type {
  ModelCapabilityInfo,
  ModelCapability,
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
  NvidiaSettingsInput,
  NvidiaSettingsResponse,
} from '../types';
import { transformModels } from './models';
import { getGatewayUrl, normalizeGatewayUrl } from './gatewayConfig';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getNvidiaApiKey, getNvidiaBaseUrl, hasNvidiaApiKey } from './nvidiaConfig';

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

async function healthAt(gatewayUrl: string): Promise<HealthResponse> {
  const response = await fetch(`${normalizeGatewayUrl(gatewayUrl)}/api/health`);
  return handleResponse<HealthResponse>(response);
}
async function nativeNvidiaRequest<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  apiKeyOverride?: string,
  baseUrlOverride?: string,
): Promise<T> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native NVIDIA transport is available only in the Android app');
  }

  const apiKey = apiKeyOverride?.trim() || await getNvidiaApiKey();
  if (!apiKey) {
    throw new APIError(
      'NVIDIA API key is not configured',
      'NVIDIA_NOT_CONFIGURED',
      503,
      false,
      'nvidia',
    );
  }

  const baseUrl = baseUrlOverride ? normalizeNvidiaBaseUrl(baseUrlOverride) : getNvidiaBaseUrl();
  const response = await CapacitorHttp.request({
    url: `${baseUrl}${path}`,
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    data: body,
    connectTimeout: 30000,
    readTimeout: method === 'POST' ? 120000 : 30000,
    responseType: 'json',
  });

  const data = response.data;
  if (response.status < 200 || response.status >= 300) {
    const detail =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : undefined;
    const nestedError =
      detail?.error && typeof detail.error === 'object'
        ? (detail.error as Record<string, unknown>)
        : undefined;
    const message =
      (nestedError?.message as string | undefined) ??
      (detail?.message as string | undefined) ??
      `NVIDIA request failed: ${response.status}`;
    const code =
      (nestedError?.code as string | undefined) ??
      (detail?.code as string | undefined) ??
      'NVIDIA_REQUEST_FAILED';
    throw new APIError(
      message,
      code,
      response.status,
      response.status >= 500,
      'nvidia',
    );
  }

  return data as T;
}

async function nvidiaConfiguredForClient(): Promise<boolean> {
  return Capacitor.isNativePlatform() && await hasNvidiaApiKey();
}

function normalizeDirectModels(data: any): ModelCapabilityInfo[] {
  const models = Array.isArray(data?.data) ? data.data : [];
  const discoveredAt = new Date().toISOString();
  return models.map((model: Record<string, unknown>) => {
    const id = String(model.id ?? '').trim();
    const rawCapabilities: ModelCapability[] = Array.isArray(model.capabilities)
      ? model.capabilities.filter(
          (item): item is ModelCapability =>
            typeof item === 'string' &&
            [
              'chat',
              'reasoning',
              'vision',
              'tool-calling',
              'image-generation',
              'video-generation',
              'asr',
              'tts',
            ].includes(item as ModelCapability),
        )
      : [];
    const capabilities: ModelCapability[] =
      rawCapabilities.length > 0 ? rawCapabilities : ['chat'];

    return {
      id,
      name: typeof model.name === 'string' ? model.name : id,
      provider: 'nvidia',
      endpointFamily: 'chat',
      inputModalities: capabilities.includes('vision') ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      capabilities,
      discoveredAt,
      contextWindow:
        typeof model.context_window === 'number' ? model.context_window : undefined,
      maxOutputTokens:
        typeof model.max_output_tokens === 'number' ? model.max_output_tokens : undefined,
      capabilitySource: 'provider',
    };
  }).filter((model: ModelCapabilityInfo) => model.id.length > 0);
}


export const api = {
  /**
   * Health check endpoint
   */
  async health(): Promise<HealthResponse> {
    return healthAt(getGatewayUrl());
  },

  /**
   * Probe an explicit gateway URL without changing client configuration.
   */
  async healthAt(gatewayUrl: string): Promise<HealthResponse> {
    return healthAt(gatewayUrl);
  },

  async testNvidiaSettings(settings: NvidiaSettingsInput): Promise<{ modelsAvailable: number }> {
    const baseUrl = normalizeNvidiaBaseUrl(settings.baseUrl);
    if (!Capacitor.isNativePlatform()) {
      throw new Error('NVIDIA direct setup is available in the Android app');
    }

    const data = await nativeNvidiaRequest<{ data: unknown[] }>(
      '/models',
      'GET',
      undefined,
      settings.apiKey,
      baseUrl,
    );
    return {
      modelsAvailable: Array.isArray(data?.data) ? data.data.length : 0,
    };
  },

  /**
   * Configure NVIDIA on the gateway. Neither credential is persisted by the client.
   */
  async saveNvidiaSettings(
    settings: NvidiaSettingsInput,
    adminToken: string,
  ): Promise<NvidiaSettingsResponse> {
    const response = await fetch(`${getGatewayUrl()}/api/settings/nvidia`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-NIM-Hub-Admin-Token': adminToken,
      },
      body: JSON.stringify({
        api_key: settings.apiKey,
        base_url: settings.baseUrl,
      }),
    });
    return handleResponse<NvidiaSettingsResponse>(response);
  },

  /**
   * List available models from NVIDIA NIM
   */
  async listModels(): Promise<ModelCapabilityInfo[]> {
    if (await nvidiaConfiguredForClient()) {
      const data = await nativeNvidiaRequest<{ data: unknown[] }>('/models', 'GET');
      return transformModels(normalizeDirectModels(data));
    }

    const apiKey = await getNvidiaApiKey();
    const response = await fetch(`${getGatewayUrl()}/api/models`, {
      headers: apiKey ? { 'X-NVIDIA-API-Key': apiKey } : undefined,
    });
    const data = await handleResponse<NIMModelListResponse>(response);
    return transformModels(data.data);
  },

  /**
   * Non-streaming chat completion
   */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const payload = { ...request, stream: false };

    if (await nvidiaConfiguredForClient()) {
      return nativeNvidiaRequest<ChatCompletionResponse>(
        '/chat/completions',
        'POST',
        payload,
      );
    }

    const apiKey = await getNvidiaApiKey();
    const response = await fetch(`${getGatewayUrl()}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-NVIDIA-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    return handleResponse<ChatCompletionResponse>(response);
  },

  /**
   * Streaming chat completion using SSE
   */
  async *chatStream(
    request: ChatCompletionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (await nvidiaConfiguredForClient()) {
      const response = await nativeNvidiaRequest<ChatCompletionResponse>(
        '/chat/completions',
        'POST',
        { ...request, stream: false },
      );
      if (signal?.aborted) return;
      const choice = response.choices?.[0];
      yield {
        id: response.id,
        object: 'chat.completion.chunk',
        created: response.created,
        model: response.model,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: typeof choice?.message?.content === 'string'
              ? choice.message.content
              : '',
          },
          finish_reason: choice?.finish_reason ?? 'stop',
        }],
      };
      return;
    }

    const apiKey = await getNvidiaApiKey();
    const response = await fetch(`${getGatewayUrl()}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-NVIDIA-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal,
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
        const lines = buffer.split('\n');
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
    const response = await fetch(`${getGatewayUrl()}/api/mcp/servers`);
    const data = await handleResponse<{ servers: MCPServerSummary[] }>(response);
    return data.servers;
  },

  /**
   * Discover sanitized MCP tool metadata.
   */
  async listMCPTools(): Promise<MCPToolSummary[]> {
    const response = await fetch(`${getGatewayUrl()}/api/mcp/tools`);
    const data = await handleResponse<{ tools: MCPToolSummary[] }>(response);
    return data.tools;
  },

  /**
   * Call one MCP tool through the gateway permission boundary.
   */
  async callMCPTool(request: MCPToolCallRequest): Promise<MCPToolResult> {
    const response = await fetch(`${getGatewayUrl()}/api/mcp/call`, {
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
    const apiKey = await getNvidiaApiKey();
    const response = await fetch(`${getGatewayUrl()}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-NVIDIA-API-Key': apiKey } : {}),
      },
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
    const apiKey = await getNvidiaApiKey();
    const response = await fetch(`${getGatewayUrl()}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-NVIDIA-API-Key': apiKey } : {}),
      },
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
        const lines = buffer.split('\n');
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

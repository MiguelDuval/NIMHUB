/**
 * Chat-related type definitions
 */

import type { ModelCapabilityInfo } from './index';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatMessageContent[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export type ChatMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: ChatTool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatChunkChoice[];
}

export interface ChatChunkChoice {
  index: number;
  delta: {
    role?: ChatRole;
    content?: string;
    tool_calls?: ChatToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

// ============================================================================
// Conversation Persistence Types
// ============================================================================

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string | ChatMessageContent[];
  createdAt: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
}
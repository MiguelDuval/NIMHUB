/**
 * Chat Hook with Streaming, Retry, and Cancellation
 * Handles the complete request lifecycle for chat completions
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { api, APIError } from '../services/api';
import type { ChatMessage, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, ModelCapabilityInfo } from '../types';

export type ChatStatus = 'idle' | 'pending' | 'streaming' | 'success' | 'error' | 'cancelled';

interface UseChatOptions {
  modelId: string;
  messages: ChatMessage[];
  onChunk?: (content: string, assistantMessageId?: string) => void;
  onComplete?: (response: ChatCompletionResponse, assistantMessageId?: string) => void;
  onError?: (error: APIError, assistantMessageId?: string) => void;
}

interface UseChatReturn {
  status: ChatStatus;
  error: APIError | null;
  abort: () => void;
  retry: () => Promise<void>;
  send: (messages: ChatMessage[], options?: { stream?: boolean; assistantMessageId?: string }) => Promise<ChatCompletionResponse | void>;
  isRetryable: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second

export function useChat({
  modelId,
  messages: initialMessages,
  onChunk,
  onComplete,
  onError,
}: UseChatOptions): UseChatReturn {
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<APIError | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const isMountedRef = useRef(true);
  // Store the last sent messages for retry
  const lastSentMessagesRef = useRef<ChatMessage[]>(initialMessages);
  // Use refs for callbacks to avoid re-creating send/retry
  const onChunkRef = useRef(onChunk);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => { onChunkRef.current = onChunk; }, [onChunk]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Update ref when messages change (for retry to use current messages)
  useEffect(() => {
    lastSentMessagesRef.current = initialMessages;
  }, [initialMessages]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus('cancelled');
  }, []);

  const send = useCallback(
    async (msgs: ChatMessage[], options: { stream?: boolean; assistantMessageId?: string } = {}): Promise<ChatCompletionResponse | void> => {
      const { stream = true, assistantMessageId } = options;

      // Create new abort controller for this request
      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;

      // Store messages for potential retry
      lastSentMessagesRef.current = msgs;

      setStatus(stream ? 'streaming' : 'pending');
      setError(null);

      const request: ChatCompletionRequest = {
        model: modelId,
        messages: msgs,
        stream,
        temperature: 0.7,
      };

      try {
        if (stream) {
          let accumulatedContent = '';

          for await (const chunk of api.chatStream(request)) {
            // Check for abort
            if (signal.aborted) {
              setStatus('cancelled');
              return;
            }

            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              accumulatedContent += delta;
              onChunkRef.current?.(accumulatedContent, assistantMessageId);
            }

            // Check for finish
            if (chunk.choices[0]?.finish_reason) {
              break;
            }
          }

          if (!signal.aborted && isMountedRef.current) {
            setStatus('success');
            retryCountRef.current = 0;
            // Create a minimal response object for the callback
            const response: ChatCompletionResponse = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: modelId,
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: accumulatedContent,
                },
                finish_reason: 'stop',
              }],
            };
            onCompleteRef.current?.(response, assistantMessageId);
          }
        } else {
          const response = await api.chat(request);
          if (!signal.aborted && isMountedRef.current) {
            setStatus('success');
            onCompleteRef.current?.(response, assistantMessageId);
            retryCountRef.current = 0;
            return response;
          }
        }
      } catch (err) {
        if (signal.aborted) {
          setStatus('cancelled');
          return;
        }

        const apiError = err instanceof APIError ? err : new APIError(
          err instanceof Error ? err.message : 'Unknown error',
          'UNKNOWN_ERROR',
          0,
          false
        );

        if (!isMountedRef.current) return;

        setError(apiError);
        setStatus('error');
        onErrorRef.current?.(apiError, assistantMessageId);
      }
    },
    [modelId]
  );

  const retry = useCallback(async () => {
    if (!error || !error.retryable || retryCountRef.current >= MAX_RETRIES) {
      return;
    }

    retryCountRef.current += 1;
    const delay = RETRY_DELAY_BASE * Math.pow(2, retryCountRef.current - 1); // Exponential backoff

    // Wait for delay
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (!isMountedRef.current) return;

    // Retry with the last sent messages
    await send(lastSentMessagesRef.current, { stream: true });
  }, [error, send]);

  const isRetryable = error?.retryable ?? false;

  return {
    status,
    error,
    abort,
    retry,
    send,
    isRetryable,
  };
}
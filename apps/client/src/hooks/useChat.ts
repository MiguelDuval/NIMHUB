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
  onChunk?: (content: string) => void;
  onComplete?: (response: ChatCompletionResponse) => void;
  onError?: (error: APIError) => void;
}

interface UseChatReturn {
  status: ChatStatus;
  error: APIError | null;
  abort: () => void;
  retry: () => Promise<void>;
  send: (messages: ChatMessage[], options?: { stream?: boolean }) => Promise<ChatCompletionResponse | void>;
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
    async (msgs: ChatMessage[], options: { stream?: boolean } = {}): Promise<ChatCompletionResponse | void> => {
      const { stream = true } = options;

      // Create new abort controller for this request
      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;

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
              onChunk?.(accumulatedContent);
            }

            // Check for finish
            if (chunk.choices[0]?.finish_reason) {
              break;
            }
          }

          if (!signal.aborted && isMountedRef.current) {
            setStatus('success');
            retryCountRef.current = 0;
          }
        } else {
          const response = await api.chat(request);
          if (!signal.aborted && isMountedRef.current) {
            setStatus('success');
            onComplete?.(response);
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
        onError?.(apiError);
      }
    },
    [modelId, onChunk, onComplete, onError]
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

    // Retry with the same messages
    await send(initialMessages, { stream: true });
  }, [error, initialMessages, send]);

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
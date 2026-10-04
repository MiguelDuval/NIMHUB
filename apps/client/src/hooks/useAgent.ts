import { useCallback, useRef, useState, useEffect } from 'react';
import { api, APIError } from '../services/api';
import type {
  AgentApprovalRequest,
  AgentRunResponse,
  ChatMessage,
  MCPApprovalGrant,
} from '../types';

export type AgentStatus = 'idle' | 'running' | 'approval_required' | 'success' | 'error' | 'cancelled';

export interface AgentActivity {
  id: string;
  type: 'tool_result' | 'tool_error';
  tool?: string;
  toolCallId?: string;
  isError?: boolean;
  message?: string;
  turn?: number;
}

interface UseAgentOptions {
  modelId: string;
  onMessages?: (messages: ChatMessage[]) => void | Promise<void>;
  onComplete?: (response: AgentRunResponse) => void;
}

interface UseAgentReturn {
  status: AgentStatus;
  error: APIError | null;
  approvals: AgentApprovalRequest[];
  streamingText: string;
  activities: AgentActivity[];
  run: (messages: ChatMessage[]) => Promise<void>;
  approve: () => Promise<void>;
  abort: () => void;
  reject: () => Promise<void>;
  reset: () => void;
}

function toChatMessage(value: Record<string, unknown>): ChatMessage {
  const role = value.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
    throw new Error('Agent returned unsupported message role: ' + String(role));
  }

  return {
    role,
    content: (value.content as ChatMessage['content']) ?? null,
    tool_call_id: typeof value.tool_call_id === 'string' ? value.tool_call_id : undefined,
    tool_calls: Array.isArray(value.tool_calls) ? value.tool_calls as ChatMessage['tool_calls'] : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
  };
}

export function useAgent({
  modelId,
  onMessages,
  onComplete,
}: UseAgentOptions): UseAgentReturn {
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [error, setError] = useState<APIError | null>(null);
  const [approvals, setApprovals] = useState<AgentApprovalRequest[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [activities, setActivities] = useState<AgentActivity[]>([]);

  const continuationRef = useRef<ChatMessage[]>([]);
  const previousLengthRef = useRef(0);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const isCurrentRun = useCallback((runId: number) => (
    mountedRef.current && runIdRef.current === runId
  ), []);

  const absorbResponse = useCallback(
    async (response: AgentRunResponse) => {
      const messages = response.messages.map(toChatMessage);
      const delta = messages.slice(previousLengthRef.current);
      previousLengthRef.current = messages.length;
      continuationRef.current = messages;

      if (delta.length > 0) await onMessages?.(delta);

      setStreamingText('');
      setActivities([]);
      setApprovals(response.approvals);
      if (response.status === 'completed') {
        setStatus('success');
        setApprovals([]);
        onComplete?.(response);
      } else if (response.status === 'approval_required') {
        setStatus('approval_required');
      } else if (response.status === 'max_turns') {
        setStatus('success');
        onComplete?.(response);
      } else {
        setStatus('error');
      }
    },
    [onMessages, onComplete],
  );

  const consumeStream = useCallback(
    async (
      request: {
        model: string;
        messages: Array<Record<string, unknown>>;
        stream: boolean;
        approval_grants: MCPApprovalGrant[];
      },
      runId: number,
      signal: AbortSignal,
    ) => {
      let terminal = false;

      for await (const event of api.agentStream(request, signal)) {
        if (!isCurrentRun(runId)) return;

        switch (event.type) {
          case 'content_delta':
            if (event.text) {
              setStreamingText((current) => current + event.text);
            }
            break;
          case 'approval_required': {
            terminal = true;
            const response: AgentRunResponse = {
              status: 'approval_required',
              messages: event.messages ?? continuationRef.current as unknown as Array<Record<string, unknown>>,
              approvals: event.approvals ?? [],
              turns: event.turns ?? 0,
            };
            await absorbResponse(response);
            return;
          }
          case 'done': {
            terminal = true;
            const response: AgentRunResponse = {
              status: 'completed',
              response: event.response ?? null,
              messages: event.messages ?? continuationRef.current as unknown as Array<Record<string, unknown>>,
              approvals: [],
              turns: event.turns ?? 0,
            };
            await absorbResponse(response);
            return;
          }
          case 'max_turns': {
            terminal = true;
            const response: AgentRunResponse = {
              status: 'max_turns',
              response: null,
              messages: event.messages ?? continuationRef.current as unknown as Array<Record<string, unknown>>,
              approvals: [],
              turns: event.turns ?? 0,
            };
            await absorbResponse(response);
            return;
          }
          case 'error':
            terminal = true;
            throw new APIError(
              event.message ?? 'Agent stream failed',
              event.code ?? 'AGENT_FAILED',
              0,
              false,
            );
          case 'tool_result':
            setActivities((current) => [
              ...current,
              {
                id: `result-${event.tool_call_id ?? event.tool ?? current.length}`,
                type: 'tool_result',
                tool: event.tool,
                toolCallId: event.tool_call_id,
                isError: event.is_error,
                turn: event.turn,
              },
            ]);
            break;
          case 'tool_error':
            setActivities((current) => [
              ...current,
              {
                id: `error-${event.tool_call_id ?? current.length}`,
                type: 'tool_error',
                tool: event.tool,
                toolCallId: event.tool_call_id,
                message: event.message,
              },
            ]);
            break;
          case 'continue':
            break;
          default:
            break;
        }
      }

      if (isCurrentRun(runId) && !signal.aborted && !terminal) {
        throw new Error('Agent stream ended before a terminal event');
      }
    },
    [absorbResponse, isCurrentRun],
  );

  const startRun = useCallback(
    async (messages: ChatMessage[], approvalGrants: MCPApprovalGrant[]) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const runId = ++runIdRef.current;

      continuationRef.current = messages;
      previousLengthRef.current = messages.length;
      setApprovals([]);
      setActivities([]);
      setStreamingText('');
      setError(null);
      setStatus('running');

      try {
        await consumeStream(
          {
            model: modelId,
            messages: messages as unknown as Array<Record<string, unknown>>,
            stream: true,
            approval_grants: approvalGrants,
          },
          runId,
          controller.signal,
        );
      } catch (err) {
        if (!isCurrentRun(runId)) return;
        if (controller.signal.aborted) {
          setStreamingText('');
          setApprovals([]);
          setStatus('cancelled');
          return;
        }

        const apiError = err instanceof APIError
          ? err
          : new APIError(
              err instanceof Error ? err.message : 'Agent request failed',
              'AGENT_FAILED',
              0,
              false,
            );
        setStreamingText('');
        setError(apiError);
        setStatus('error');
      } finally {
        if (isCurrentRun(runId)) {
          abortControllerRef.current = null;
        }
      }
    },
    [consumeStream, isCurrentRun, modelId],
  );

  const run = useCallback(
    async (messages: ChatMessage[]) => {
      if (status === 'running') return;
      await startRun(messages, []);
    },
    [startRun, status],
  );

  const approve = useCallback(async () => {
    if (status !== 'approval_required' || approvals.length === 0) return;

    const grants: MCPApprovalGrant[] = approvals.map((approval) => ({
      approval_token: approval.approval_token,
      arguments_sha256: approval.arguments_sha256,
    }));
    await startRun(continuationRef.current, grants);
  }, [approvals, startRun, status]);

  const abort = useCallback(() => {
    runIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingText('');
    setActivities([]);
    setApprovals([]);
    setError(null);
    setStatus('cancelled');
  }, []);

  const reject = useCallback(async () => {
    const deniedApprovals = approvals;
    runIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    const deniedMessages: ChatMessage[] = deniedApprovals.map((approval) => ({
      role: 'tool',
      tool_call_id: approval.tool_call_id,
      content: JSON.stringify({
        ok: false,
        error: 'User denied this tool call.',
      }),
    }));

    continuationRef.current = [...continuationRef.current, ...deniedMessages];
    previousLengthRef.current = continuationRef.current.length;
    setStreamingText('');
    setError(null);

    if (deniedMessages.length > 0) {
      await onMessages?.(deniedMessages);
    }

    if (!mountedRef.current) return;
    setApprovals([]);
    setStatus('idle');
  }, [approvals, onMessages]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    continuationRef.current = [];
    previousLengthRef.current = 0;
    setStreamingText('');
    setActivities([]);
    setApprovals([]);
    setError(null);
    setStatus('idle');
  }, []);

  return {
    status,
    error,
    approvals,
    streamingText,
    activities,
    run,
    approve,
    abort,
    reject,
    reset,
  };
}

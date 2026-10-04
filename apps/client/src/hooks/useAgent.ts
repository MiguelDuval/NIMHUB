import { useCallback, useRef, useState, useEffect } from 'react';
import { api, APIError } from '../services/api';
import type {
  AgentApprovalRequest,
  AgentRunResponse,
  ChatMessage,
  MCPApprovalGrant,
} from '../types';

export type AgentStatus = 'idle' | 'running' | 'approval_required' | 'success' | 'error';

interface UseAgentOptions {
  modelId: string;
  onMessages?: (messages: ChatMessage[]) => void;
  onComplete?: (response: AgentRunResponse) => void;
}

interface UseAgentReturn {
  status: AgentStatus;
  error: APIError | null;
  approvals: AgentApprovalRequest[];
  run: (messages: ChatMessage[]) => Promise<void>;
  approve: () => Promise<void>;
  reject: () => void;
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

  const continuationRef = useRef<ChatMessage[]>([]);
  const previousLengthRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const absorbResponse = useCallback(
    (response: AgentRunResponse) => {
      const messages = response.messages.map(toChatMessage);
      const delta = messages.slice(previousLengthRef.current);
      previousLengthRef.current = messages.length;
      continuationRef.current = messages;

      if (delta.length > 0) onMessages?.(delta);

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

  const run = useCallback(
    async (messages: ChatMessage[]) => {
      if (status === 'running') return;

      continuationRef.current = messages;
      previousLengthRef.current = messages.length;
      setApprovals([]);
      setError(null);
      setStatus('running');

      try {
        const response = await api.agent({
          model: modelId,
          messages: messages as unknown as Array<Record<string, unknown>>,
          stream: false,
          approval_grants: [],
        });
        if (!mountedRef.current) return;
        absorbResponse(response);
      } catch (err) {
        if (!mountedRef.current) return;
        const apiError = err instanceof APIError
          ? err
          : new APIError(
              err instanceof Error ? err.message : 'Agent request failed',
              'AGENT_FAILED',
              0,
              false,
            );
        setError(apiError);
        setStatus('error');
      }
    },
    [absorbResponse, modelId, status],
  );

  const approve = useCallback(async () => {
    if (status !== 'approval_required' || approvals.length === 0) return;

    const grants: MCPApprovalGrant[] = approvals.map((approval) => ({
      approval_token: approval.approval_token,
      arguments_sha256: approval.arguments_sha256,
    }));
    setError(null);
    setStatus('running');

    try {
      const response = await api.agent({
        model: modelId,
        messages: continuationRef.current as unknown as Array<Record<string, unknown>>,
        stream: false,
        approval_grants: grants,
      });
      if (!mountedRef.current) return;
      absorbResponse(response);
    } catch (err) {
      if (!mountedRef.current) return;
      const apiError = err instanceof APIError
        ? err
        : new APIError(
            err instanceof Error ? err.message : 'Agent approval continuation failed',
            'AGENT_FAILED',
            0,
            false,
          );
      setError(apiError);
      setStatus('error');
    }
  }, [absorbResponse, approvals, modelId, status]);

  const reject = useCallback(() => {
    setApprovals([]);
    setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    continuationRef.current = [];
    previousLengthRef.current = 0;
    setApprovals([]);
    setError(null);
    setStatus('idle');
  }, []);

  return {
    status,
    error,
    approvals,
    run,
    approve,
    reject,
    reset,
  };
}
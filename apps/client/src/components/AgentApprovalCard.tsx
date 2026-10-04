import { useCallback, useState } from 'react';
import type { AgentApprovalRequest } from '../types';

interface AgentApprovalCardProps {
  approvals: AgentApprovalRequest[];
  onApprove: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  busy?: boolean;
}

export function AgentApprovalCard({
  approvals,
  onApprove,
  onReject,
  busy = false,
}: AgentApprovalCardProps) {
  const [rejecting, setRejecting] = useState(false);

  const handleReject = useCallback(async () => {
    if (busy || rejecting) return;
    setRejecting(true);
    try {
      await onReject();
    } finally {
      setRejecting(false);
    }
  }, [busy, onReject, rejecting]);

  if (approvals.length === 0) return null;

  const actionBusy = busy || rejecting;

  return (
    <section className="agent-approval-card" aria-label="Tool approval required">
      <div className="agent-approval-header">
        <div>
          <span className="agent-approval-eyebrow">ACTION REQUIRES APPROVAL</span>
          <h2>{approvals.length === 1 ? 'Review this tool call' : 'Review these tool calls'}</h2>
        </div>
        <span className="agent-approval-badge">
          {approvals.length} pending
        </span>
      </div>

      <div className="agent-approval-list">
        {approvals.map((approval) => (
          <article className="agent-approval-item" key={approval.tool_call_id || approval.tool + ':' + approval.arguments_sha256}>
            <div className="agent-approval-tool">
              <strong>{approval.tool}</strong>
              <span className={'agent-permission ' + approval.permission}>
                {approval.permission}
              </span>
              {approval.destructive && (
                <span className="agent-permission destructive">destructive</span>
              )}
            </div>
            {approval.description && (
              <p className="agent-approval-description">{approval.description}</p>
            )}
            <pre className="agent-approval-arguments">
              {JSON.stringify(approval.arguments, null, 2)}
            </pre>
          </article>
        ))}
      </div>

      <div className="agent-approval-actions">
        <p>Approval is limited to the exact operation shown above.</p>
        <div>
          <button
            className="btn-secondary"
            onClick={handleReject}
            disabled={actionBusy}
          >
            {rejecting ? 'Declining…' : 'Not now'}
          </button>
          <button
            className="btn-primary"
            onClick={onApprove}
            disabled={actionBusy}
          >
            {busy ? 'Executing…' : 'Approve & Run'}
          </button>
        </div>
      </div>
    </section>
  );
}

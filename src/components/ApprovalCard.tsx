/**
 * 审批卡（M7.4）：运行期挂起审批的裁决面（挂起-裁决机制）。
 * 允许一次 / 会话内允许 / 拒绝；裁决后后端恢复流式。
 */

import type { ReactElement } from 'react';
import type { ApprovalVerdict, RuntimeApprovalDto } from '../types';

export interface ApprovalCardProps {
  approvals: RuntimeApprovalDto[];
  onResolve: (approvalId: string, verdict: ApprovalVerdict) => void;
}

function formatArgs(argsJson: string): string {
  try {
    return JSON.stringify(JSON.parse(argsJson), null, 2);
  } catch {
    return argsJson;
  }
}

export default function ApprovalCard({ approvals, onResolve }: ApprovalCardProps): ReactElement | null {
  if (approvals.length === 0) {
    return null;
  }
  return (
    <div className="approval-stack">
      {approvals.map((approval) => (
        <div key={approval.id} className="approval-card">
          <div className="approval-card__head">
            <span className="approval-card__badge">待审批</span>
            <span className="approval-card__tool">{approval.toolName}</span>
          </div>
          <pre className="approval-card__args">{formatArgs(approval.argsJson)}</pre>
          <div className="approval-card__actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onResolve(approval.id, 'ALLOW_ONCE')}
            >
              允许一次
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => onResolve(approval.id, 'ALLOW_SESSION')}
            >
              会话内允许
            </button>
            <button
              type="button"
              className="btn btn--small btn--danger"
              onClick={() => onResolve(approval.id, 'DENY')}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

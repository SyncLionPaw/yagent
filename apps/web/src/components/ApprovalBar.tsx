import { Check, ShieldAlert, X } from 'lucide-react'
import type { ApprovalRequest } from '../approval'

/** 工具审批条：贴在输入框上沿，逐条确认危险操作 */
export function ApprovalBar({
  req,
  onAnswer,
}: {
  req: ApprovalRequest
  onAnswer: (ok: boolean) => void
}) {
  const desc = typeof req.input.desc === 'string' ? req.input.desc.trim() : ''
  const target = String(req.input.command ?? req.input.path ?? '')
  const detail = desc && target ? `${desc} — ${target}` : desc || target
  return (
    <div className="approval-bar">
      <ShieldAlert className="ic ab-icon" />
      <code className="ab-detail">{detail}</code>
      <span className="ab-actions">
        <button
          type="button"
          className="ab-btn ab-deny"
          title="拒绝"
          aria-label="拒绝"
          onClick={() => onAnswer(false)}
        >
          <X className="ic" />
        </button>
        <button
          type="button"
          className="ab-btn ab-allow"
          title="允许"
          aria-label="允许"
          onClick={() => onAnswer(true)}
        >
          <Check className="ic" />
        </button>
      </span>
    </div>
  )
}

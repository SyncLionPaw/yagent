import { Info, X } from 'lucide-react'

/** slash 等本地命令结果：复用审批条外形，贴在输入框上方 */
export function ComposerNoticeBar({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="approval-bar approval-bar-notice" role="status">
      <Info className="ic ab-icon" />
      <span className="ab-detail ab-detail-plain">{message}</span>
      <span className="ab-actions">
        <button type="button" className="ab-btn" title="关闭" aria-label="关闭" onClick={onDismiss}>
          <X className="ic" />
        </button>
      </span>
    </div>
  )
}

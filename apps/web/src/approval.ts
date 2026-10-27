/* ============ 工具审批：渲染层批准/拒绝，替代主进程原生模态框 ============ */

export type ApprovalMode = 'ask' | 'files' | 'all'

export interface ApprovalRequest {
  name: string
  input: Record<string, unknown>
}

type ApprovalHandler = (req: ApprovalRequest, signal: AbortSignal) => Promise<boolean>

let handler: ApprovalHandler | null = null
/** 审批档位：ask 全问 / files 只自动写文件 / all 全自动 */
let approvalMode: ApprovalMode = 'ask'

/** App 启动时注册（把请求推进 React state） */
export function registerApprovalHandler(h: ApprovalHandler): void {
  handler = h
}

export function setApprovalMode(mode: ApprovalMode): void {
  approvalMode = mode
}

/** @deprecated 用 setApprovalMode */
export function setAutoApprove(on: boolean): void {
  approvalMode = on ? 'all' : 'ask'
}

export function getApprovalMode(): ApprovalMode {
  return approvalMode
}

export function getAutoApprove(): boolean {
  return approvalMode === 'all'
}

function shouldAutoApprove(toolName: string): boolean {
  if (approvalMode === 'all') return true
  if (approvalMode === 'files' && toolName === 'write_file') return true
  return false
}

/** executor 调用：按档位放行或挂起等审批条；abort 视为拒绝 */
export function requestApproval(req: ApprovalRequest, signal: AbortSignal): Promise<boolean> {
  if (shouldAutoApprove(req.name)) return Promise.resolve(true)
  if (!handler) return Promise.resolve(false)
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = () => resolve(false)
    signal.addEventListener('abort', onAbort, { once: true })
    void handler!(req, signal).then((ok) => {
      signal.removeEventListener('abort', onAbort)
      resolve(ok)
    })
  })
}

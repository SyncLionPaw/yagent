import { useCallback, useEffect, useState } from 'react'
import {
  registerApprovalHandler,
  setApprovalMode,
  type ApprovalMode,
  type ApprovalRequest,
} from '../approval'

type ApprovalItem = {
  id: number
  req: ApprovalRequest
  resolve: (ok: boolean) => void
}

/** 工具审批队列 + 档位同步（升档时自动放行已不需确认的项） */
export function useApprovals(approvalMode: ApprovalMode) {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([])

  useEffect(() => {
    let seq = 0
    registerApprovalHandler(
      (req) =>
        new Promise<boolean>((resolve) => {
          setApprovals((list) => [...list, { id: ++seq, req, resolve }])
        }),
    )
  }, [])

  useEffect(() => {
    setApprovalMode(approvalMode)
    setApprovals((list) => {
      const keep: ApprovalItem[] = []
      for (const a of list) {
        const auto =
          approvalMode === 'all' || (approvalMode === 'files' && a.req.name === 'write_file')
        if (auto) a.resolve(true)
        else keep.push(a)
      }
      return keep
    })
  }, [approvalMode])

  const answerFront = useCallback((ok: boolean) => {
    setApprovals((list) => {
      const [head, ...rest] = list
      if (head) head.resolve(ok)
      return rest
    })
  }, [])

  return { approvals, answerFront }
}

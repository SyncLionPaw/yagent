import { useEffect, useState } from 'react'
import type { Settings } from '@yagent/core'
import { sandboxPlace } from '../lib/sandboxPlace'

/** 纯 chat 的沙箱名字。跟随设置里的端点，不等切换对话。绑了工作目录时没有沙箱名。 */
export function useSandboxLabel(
  convId: string,
  workdir: string | null | undefined,
  sandbox: Settings['sandbox'] | undefined,
): string | null {
  const [label, setLabel] = useState<string | null>(null)
  const env = sandbox?.env
  const apiUrl = sandbox?.provider?.apiUrl ?? ''
  const templateId = sandbox?.provider?.templateId ?? ''
  const proxyNodeIp = sandbox?.provider?.proxyNodeIp ?? ''
  const name = sandbox?.provider?.label ?? ''

  useEffect(() => {
    if (workdir?.trim()) {
      setLabel(null)
      return
    }
    const read = window.yagentDesktop?.sandbox?.info
    if (!read) {
      setLabel(null)
      return
    }
    let cancel = false
    void read(convId, {
      env,
      provider: { apiUrl, templateId, proxyNodeIp, label: name },
    }).then((box) => {
      if (!cancel) setLabel(sandboxPlace(box))
    })
    return () => {
      cancel = true
    }
  }, [convId, workdir, env, apiUrl, templateId, proxyNodeIp, name])

  return label
}

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

export type SandboxLink = 'checking' | 'ok' | 'fail'

/** 纯 chat 顶栏的灯。外部沙箱问控制面；本机模式直接算通。绑了目录时不探测。 */
export function useSandboxLink(
  workdir: string | null | undefined,
  sandbox: Settings['sandbox'] | undefined,
): { status: SandboxLink | null; error: string } {
  const bound = !!workdir?.trim()
  const env = sandbox?.env
  const apiUrl = sandbox?.provider?.apiUrl ?? ''
  const templateId = sandbox?.provider?.templateId ?? ''
  const proxyNodeIp = sandbox?.provider?.proxyNodeIp ?? ''
  const name = sandbox?.provider?.label ?? ''
  const key = `${env ?? ''}|${apiUrl}|${templateId}|${proxyNodeIp}|${name}`
  const [link, setLink] = useState<{ key: string; status: SandboxLink; error: string } | null>(null)

  useEffect(() => {
    if (bound) return
    const ping = window.yagentDesktop?.sandbox?.ping
    if (!ping) return
    let alive = true
    const run = () => {
      void ping({
        env,
        provider: { apiUrl, templateId, proxyNodeIp, label: name },
      })
        .then((result) => {
          if (!alive) return
          setLink({
            key,
            status: result.ok ? 'ok' : 'fail',
            error: result.ok ? '' : (result.error ?? '连接失败'),
          })
        })
        .catch((err) => {
          if (!alive) return
          setLink({
            key,
            status: 'fail',
            error: err instanceof Error ? err.message : '连接失败',
          })
        })
    }
    run()
    const timer = setInterval(run, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [bound, key, env, apiUrl, templateId, proxyNodeIp, name])

  if (bound || !window.yagentDesktop?.sandbox?.ping) return { status: null, error: '' }
  if (!link || link.key !== key) return { status: 'checking', error: '' }
  return { status: link.status, error: link.error }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseSshWorkdir } from '@yagent/core'
import { setRemoteToolsDegraded, updateToolsFor } from '../harness'
import type { Settings } from '@yagent/core'

export type SshProbeStatus = 'checking' | 'ok' | 'fail'

type ProbeResult = { host: string; status: SshProbeStatus; error: string }

async function pingHost(host: string): Promise<ProbeResult> {
  try {
    const r = await window.yagentDesktop?.ssh?.ping(host)
    return {
      host,
      status: r?.ok ? 'ok' : 'fail',
      error: r?.ok ? '' : (r?.error ?? '连接失败'),
    }
  } catch (e) {
    return {
      host,
      status: 'fail',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * SSH 远程会话连通性探测：顶栏状态点、输入框降级、工具裁剪与 system reminder。
 */
export function useSshProbe(
  workdir: string | null | undefined,
  activeConvId: string,
  tools: Settings['tools'],
) {
  const sshHost = workdir ? parseSshWorkdir(workdir)?.host ?? null : null
  const [sshProbe, setSshProbe] = useState<ProbeResult | null>(null)
  const inflightRef = useRef(false)

  // 必须与当前 host 对齐，避免换机会话时沿用上一台的 fail
  const sshStatus: SshProbeStatus | null = sshHost
    ? sshProbe?.host === sshHost
      ? sshProbe.status
      : 'checking'
    : null
  const sshError = sshHost && sshProbe?.host === sshHost ? sshProbe.error : ''
  // checking / fail 都降级：避免探测窗口内 Agent 误调远程工具
  const remoteToolsDegraded = sshStatus === 'fail' || sshStatus === 'checking'

  const runProbe = useCallback(async (host: string) => {
    if (inflightRef.current) return
    inflightRef.current = true
    setSshProbe({ host, status: 'checking', error: '' })
    try {
      setSshProbe(await pingHost(host))
    } finally {
      inflightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!sshHost) return
    let alive = true
    inflightRef.current = false
    setSshProbe({ host: sshHost, status: 'checking', error: '' })
    const probe = () => {
      if (!alive || inflightRef.current) return
      inflightRef.current = true
      void pingHost(sshHost)
        .then((r) => {
          if (alive) setSshProbe(r)
        })
        .finally(() => {
          inflightRef.current = false
        })
    }
    probe()
    const t = setInterval(probe, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [sshHost])

  // 探测中/离线：砍掉远程工具 + 注入 reminder；恢复或非 SSH：清掉
  useEffect(() => {
    const phase = sshStatus === 'checking' || sshStatus === 'fail' ? sshStatus : null
    setRemoteToolsDegraded(remoteToolsDegraded, sshHost ?? undefined, phase)
    if (activeConvId) {
      updateToolsFor(activeConvId, tools, { remoteOffline: remoteToolsDegraded })
    }
  }, [remoteToolsDegraded, sshHost, sshStatus, activeConvId, tools])

  const retry = useCallback(() => {
    if (sshHost) void runProbe(sshHost)
  }, [sshHost, runProbe])

  return {
    sshHost,
    sshStatus,
    sshError,
    remoteToolsDegraded,
    retry,
  }
}

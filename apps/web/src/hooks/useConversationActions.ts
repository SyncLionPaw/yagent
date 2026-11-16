import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Insight, Settings } from '@yagent/core'
import { formatSshWorkdir, parseSshWorkdir } from '@yagent/core'
import {
  harness,
  setRemoteToolsDegraded,
  updateToolsFor,
} from '../harness'
import { conversationStore } from '../conversations'
import { deleteInsight, readInsights } from '../insights'
import type { ComposerHandle } from '../components/Composer'
import type { SshProbeStatus } from './useSshProbe'
import { useSendMessage } from './useSendMessage'

export function pickInitialActiveConvId(): string {
  const list = harness.listConversations()
  const empty = list.find(
    (c) => !c.archived && c.workdir == null && Object.keys(c.nodes).length === 0,
  )
  return empty?.id ?? list[list.length - 1]?.id ?? list[0]?.id ?? ''
}

/**
 * 新建 / 删除 / 发送 / 编辑 / 绑定目录等动作（activeConvId 由外部持有）。
 */
export function useConversationActions(opts: {
  activeConvId: string
  setActiveConvId: Dispatch<SetStateAction<string>>
  tools: Settings['tools']
  sshHost: string | null
  sshStatus: SshProbeStatus | null
  trackProject: (workdir: string | null | undefined) => void
  refreshSight: () => void
}) {
  const {
    activeConvId,
    setActiveConvId,
    tools,
    sshHost,
    sshStatus,
    trackProject,
    refreshSight,
  } = opts

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [slashNotice, setSlashNotice] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null)
  const composerRef = useRef<ComposerHandle | null>(null)

  useEffect(() => {
    if (!slashNotice) return
    const t = setTimeout(() => setSlashNotice(''), 3600)
    return () => clearTimeout(t)
  }, [slashNotice])

  // 切换会话：取消编辑（草稿由 Composer 按 conversationId 自清）
  useEffect(() => {
    setEditingNodeId(null)
  }, [activeConvId])

  const openOrCreate = useCallback(
    (title: string, workdir: string | null) => {
      const empty = harness
        .listConversations()
        .find((c) => !c.archived && c.workdir === workdir && Object.keys(c.nodes).length === 0)
      if (empty) {
        setActiveConvId(empty.id)
        trackProject(workdir)
        composerRef.current?.focus()
        return empty
      }
      const conv = harness.createConversation(title, workdir)
      setActiveConvId(conv.id)
      if (workdir) {
        const host = parseSshWorkdir(workdir)?.host
        const offline =
          !!host && host === sshHost && (sshStatus === 'fail' || sshStatus === 'checking')
        updateToolsFor(conv.id, tools, { remoteOffline: offline })
      }
      trackProject(workdir)
      composerRef.current?.focus()
      return conv
    },
    [tools, trackProject, sshHost, sshStatus, setActiveConvId],
  )

  const handleRename = useCallback(
    (title: string) => {
      if (harness.getConversation(activeConvId)) harness.rename(activeConvId, title)
    },
    [activeConvId],
  )

  const handleToggleArchive = useCallback(() => {
    const conv = harness.getConversation(activeConvId)
    if (!conv) return
    const next = !conv.archived
    harness.setArchived(activeConvId, next)
    if (next) {
      const rest = harness
        .listConversations()
        .filter((c) => c.id !== activeConvId && !c.archived)
      if (rest.length) setActiveConvId(rest[rest.length - 1]!.id)
    }
  }, [activeConvId, setActiveConvId])

  const handleDeleteConversation = useCallback(() => {
    const conv = harness.getConversation(activeConvId)
    if (!conv) return
    setDeleteConfirm({ id: conv.id, title: conv.title })
  }, [activeConvId])

  const confirmDeleteConversation = useCallback(() => {
    const pending = deleteConfirm
    setDeleteConfirm(null)
    if (!pending) return
    const conv = harness.getConversation(pending.id)
    if (!conv) return
    const id = conv.id
    const workdir = conv.workdir
    const extraPaths = conv.attachments
      .map((a) => a.name)
      .filter((p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))
    const rest = harness.listConversations().filter((c) => c.id !== id)
    if (rest.length) {
      setActiveConvId(rest[0]!.id)
    } else {
      const fresh = harness.createConversation('新对话', null)
      setActiveConvId(fresh.id)
    }
    composerRef.current?.clear()
    const insightIds = [...(conv.insightIds ?? [])]
    void (async () => {
      await conversationStore.remove(id)
      const tips = await readInsights(insightIds).catch(() => [] as Insight[])
      await Promise.all(
        tips.map((ins) =>
          deleteInsight(ins.id, { preserveSight: ins.mark === 'keep' }).catch(() => undefined),
        ),
      )
      const kept = new Set(tips.map((t) => t.id))
      await Promise.all(
        insightIds
          .filter((iid) => !kept.has(iid))
          .map((iid) => deleteInsight(iid).catch(() => undefined)),
      )
      refreshSight()
      await window.yagentDesktop?.attachments
        ?.purge?.(id, workdir, extraPaths)
        .catch(() => undefined)
    })()
  }, [deleteConfirm, refreshSight, setActiveConvId])

  const cancelEditMessage = useCallback(() => {
    setEditingNodeId(null)
    composerRef.current?.clear()
  }, [])

  const startEditUserMessage = useCallback((nodeId: string, text: string) => {
    setEditingNodeId(nodeId)
    composerRef.current?.setDraft(text, { clearAttachments: true })
    requestAnimationFrame(() => {
      composerRef.current?.focus()
    })
  }, [])

  const { handleSend } = useSendMessage({
    activeConvId,
    tools,
    sshStatus,
    editingNodeId,
    setEditingNodeId,
    setSlashNotice,
    openOrCreate,
  })

  const handleStop = useCallback(() => harness.abort(activeConvId), [activeConvId])

  const handleBindWorkdir = useCallback(async () => {
    const selectedPath = await window.yagentDesktop?.dialog?.selectDirectory?.()
    if (selectedPath) {
      harness.setWorkdir(activeConvId, selectedPath)
      setRemoteToolsDegraded(false)
      updateToolsFor(activeConvId, tools, { remoteOffline: false })
      trackProject(selectedPath)
    }
  }, [activeConvId, tools, trackProject])

  const handleNewTask = useCallback(async () => {
    const dir = await window.yagentDesktop?.dialog?.selectDirectory?.()
    if (!dir) {
      if (!window.yagentDesktop) openOrCreate('新对话', null)
      return
    }
    openOrCreate('新任务', dir)
  }, [openOrCreate])

  const handleNewChat = useCallback(() => {
    openOrCreate('新对话', null)
  }, [openOrCreate])

  const handleNewSshTask = useCallback(
    (host: string, path: string) => {
      openOrCreate('新任务', formatSshWorkdir(host, path))
    },
    [openOrCreate],
  )

  const handleNewTaskInProject = useCallback(
    (workdir: string) => {
      openOrCreate('新任务', workdir)
    },
    [openOrCreate],
  )

  return {
    editingNodeId,
    slashNotice,
    setSlashNotice,
    deleteConfirm,
    setDeleteConfirm,
    composerRef: composerRef as RefObject<ComposerHandle | null>,
    handleRename,
    handleToggleArchive,
    handleDeleteConversation,
    confirmDeleteConversation,
    cancelEditMessage,
    startEditUserMessage,
    handleSend,
    handleStop,
    handleBindWorkdir,
    handleNewTask,
    handleNewChat,
    handleNewSshTask,
    handleNewTaskInProject,
  }
}

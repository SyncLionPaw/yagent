import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { Settings } from '@yagent/core'
import { parseSshWorkdir } from '@yagent/core'
import { harness, syncSkillsIntoHarness, updateToolsFor } from '../harness'
import { matchSlashCommand, unknownSlashMessage } from '../slashCommands'
import { prepareSendAttachments } from '../lib/sendAttachments'
import type { ComposerSendPayload } from '../components/Composer'
import type { Conversation } from '@yagent/core'
import type { SshProbeStatus } from './useSshProbe'

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 18 ? `${clean.slice(0, 18)}…` : clean
}

function isRemoteOffline(
  workdir: string | null | undefined,
  sshStatus: SshProbeStatus | null,
): boolean {
  return (
    !!parseSshWorkdir(workdir)?.host && (sshStatus === 'fail' || sshStatus === 'checking')
  )
}

/** 发送 / 编辑重跑 / slash；从 useConversationActions 拆出以保持文件短小 */
export function useSendMessage(opts: {
  activeConvId: string
  tools: Settings['tools']
  sshStatus: SshProbeStatus | null
  editingNodeId: string | null
  setEditingNodeId: Dispatch<SetStateAction<string | null>>
  setSlashNotice: Dispatch<SetStateAction<string>>
  openOrCreate: (title: string, workdir: string | null) => Conversation
}) {
  const {
    activeConvId,
    tools,
    sshStatus,
    editingNodeId,
    setEditingNodeId,
    setSlashNotice,
    openOrCreate,
  } = opts

  const handleEditUserMessage = useCallback(
    (nodeId: string, nextVisible: string) => {
      const conv = harness.getConversation(activeConvId)
      if (!conv || conv.status === 'running') return
      const node = conv.nodes[nodeId]
      if (!node || (node.role !== 'round' && node.role !== 'user')) return

      const textBlock = node.blocks.find((b) => b.type === 'text')
      const raw = textBlock?.type === 'text' ? textBlock.text : ''
      const zw = raw.indexOf('\u200c')
      const notes = zw >= 0 ? raw.slice(zw) : ''
      const visible = nextVisible.trimEnd() || (notes ? '请查看附件' : '')
      const message = notes ? `${visible}\n\n${notes}` : visible

      const images: { mime: string; name: string; path?: string; data: string }[] = []
      const files: {
        name: string
        size: number
        path?: string
        mime?: string
        preview?:
          | { kind: 'html'; html: string }
          | { kind: 'md'; text: string }
          | { kind: 'pdf'; dataUrl: string }
      }[] = []
      if (node.role === 'round') {
        for (let i = 1; i < node.blocks.length; i++) {
          const b = node.blocks[i]
          if (b.type === 'image') {
            images.push({ mime: b.mime, name: b.name, path: b.path, data: b.data })
          } else if (b.type === 'file') {
            files.push({
              name: b.name,
              size: b.size,
              path: b.path,
              mime: b.mime,
              preview: b.preview,
            })
          } else break
        }
      }

      harness.setActiveNode(conv.id, node.parentId ?? '')
      updateToolsFor(conv.id, tools, { remoteOffline: isRemoteOffline(conv.workdir, sshStatus) })
      void (async () => {
        await syncSkillsIntoHarness()
        await harness.sendMessage(conv.id, message, {
          ...(images.length ? { images } : {}),
          ...(files.length ? { files } : {}),
        })
      })().catch(() => undefined)
    },
    [activeConvId, tools, sshStatus],
  )

  const handleSend = useCallback(
    (payload: ComposerSendPayload) => {
      const text = payload.text.trim()
      const pendingFiles = payload.files
      if (!text && pendingFiles.length === 0) return

      if (!editingNodeId && pendingFiles.length === 0) {
        const cmd = matchSlashCommand(text)
        if (cmd) {
          void cmd.run().then((r) => setSlashNotice(r.message))
          return
        }
        const unknown = unknownSlashMessage(text)
        if (unknown) {
          setSlashNotice(unknown)
          return
        }
      }

      let conv = harness.getConversation(activeConvId)
      if (!conv) {
        conv = openOrCreate('新对话', null)
      }

      if (editingNodeId) {
        const nodeId = editingNodeId
        setEditingNodeId(null)
        handleEditUserMessage(nodeId, payload.text)
        return
      }

      const titleSeed = text || pendingFiles[0]?.name || '新对话'
      if (
        (conv.title === '新任务' || conv.title === '新对话') &&
        Object.keys(conv.nodes).length === 0
      ) {
        harness.rename(conv.id, titleFrom(titleSeed))
      }
      const files = pendingFiles
      updateToolsFor(conv.id, tools, { remoteOffline: isRemoteOffline(conv.workdir, sshStatus) })
      void (async () => {
        await syncSkillsIntoHarness()
        const { saved, modelNotes, images, fileCards } = await prepareSendAttachments(
          conv.id,
          conv.workdir,
          files,
        )
        if (saved.length) harness.addAttachments(conv.id, saved)
        const visible = text || (files.length ? '请查看附件' : '')
        const message =
          modelNotes.length > 0 ? `${visible}\n\n\u200c${modelNotes.join('')}` : visible
        await harness
          .sendMessage(conv.id, message, {
            ...(images.length ? { images } : {}),
            ...(fileCards.length ? { files: fileCards } : {}),
          })
          .catch(() => undefined)
      })()
    },
    [
      activeConvId,
      tools,
      openOrCreate,
      editingNodeId,
      handleEditUserMessage,
      sshStatus,
      setEditingNodeId,
      setSlashNotice,
    ],
  )

  return { handleSend, handleEditUserMessage }
}

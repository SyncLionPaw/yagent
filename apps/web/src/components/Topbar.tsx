import { memo, useEffect, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Box,
  Folder,
  MessageCircle,
  PanelLeft,
  PanelRight,
  Server,
  Trash2,
} from 'lucide-react'
import type { ContentWidth, Conversation, ModelConfig } from '@yagent/core'
import { isSshWorkdir, parseSshWorkdir } from '@yagent/core'
import { sandboxPlace } from '../lib/sandboxPlace'
import { EditableTitle } from './EditableTitle'
import { ModelPicker } from './ModelPicker'
import { ShareButton } from './ShareButton'
import { WidthPicker } from './WidthPicker'

export type PopoverId = 'model' | 'share' | 'mode' | 'workdir' | 'width' | null

interface TopbarProps {
  conversation: Conversation
  models: ModelConfig[]
  currentModelId: string
  contentWidth: ContentWidth
  popover: PopoverId
  onPopover: (id: PopoverId) => void
  onToggleSidebar: () => void
  onTogglePanel: () => void
  onRename: (title: string) => void
  onSelectModel: (id: string) => void
  onContentWidth: (w: ContentWidth) => void
  onBindWorkdir: () => void
  onToggleArchive: () => void
  onDelete: () => void
  /** SSH 远程会话的连通状态；非 SSH 会话为 null */
  sshStatus?: 'checking' | 'ok' | 'fail' | null
}

export const Topbar = memo(function Topbar({
  conversation,
  models,
  currentModelId,
  contentWidth,
  popover,
  onPopover,
  onToggleSidebar,
  onTogglePanel,
  onRename,
  onSelectModel,
  onContentWidth,
  onBindWorkdir,
  onToggleArchive,
  onDelete,
  sshStatus = null,
}: TopbarProps) {
  // 分享链接 = 当前分支的只读快照 /s/{convId}-{snapshotId}
  const shareLink = `https://yagent.app/s/${conversation.id}-${conversation.activeNodeId.slice(-4) || 'snap'}`
  const archived = !!conversation.archived
  const [sandboxLabel, setSandboxLabel] = useState<string | null>(null)
  useEffect(() => {
    if (conversation.workdir?.trim()) {
      setSandboxLabel(null)
      return
    }
    let cancel = false
    void window.yagentDesktop?.sandbox?.info(conversation.id).then((box) => {
      if (cancel) return
      setSandboxLabel(sandboxPlace(box))
    })
    return () => {
      cancel = true
    }
  }, [conversation.id, conversation.workdir])

  return (
    <div className="topbar">
      <button className="icon-btn" title="侧栏 (⌘B)" onClick={onToggleSidebar}>
        <PanelLeft className="ic" />
      </button>
      <EditableTitle title={conversation.title} onCommit={onRename} />
      <span className="sep">·</span>
      <span className="meta" onClick={onBindWorkdir} style={{ cursor: 'pointer' }} title="点击选择工作目录">
        {conversation.workdir ? (
          isSshWorkdir(conversation.workdir) ? (
            <>
              <Server className="ic ic-sm" />
              <span>{parseSshWorkdir(conversation.workdir)?.host ?? conversation.workdir}</span>
            </>
          ) : (
            <>
              <Folder className="ic ic-sm" />
              <span>{conversation.workdir}</span>
            </>
          )
        ) : (
          <>
            <MessageCircle className="ic ic-sm" />
            <span>{sandboxLabel ? `chat · ${sandboxLabel}` : 'chat'}</span>
          </>
        )}
      </span>
      <div className="topbar-right">
        {conversation.workdir ? (
          <span
            className={`sandbox-status${isSshWorkdir(conversation.workdir) ? ` ssh ${sshStatus ?? 'checking'}` : ''}`}
            data-tip={
              isSshWorkdir(conversation.workdir)
                ? `SSH 远程 · ${conversation.workdir} · ${
                    sshStatus === 'ok' ? '已连接' : sshStatus === 'fail' ? '连接失败' : '检测中…'
                  }`
                : `工作区 · ${conversation.workdir}`
            }
            aria-label={
              isSshWorkdir(conversation.workdir)
                ? `SSH 远程 · ${conversation.workdir} · ${
                    sshStatus === 'ok' ? '已连接' : sshStatus === 'fail' ? '连接失败' : '检测中…'
                  }`
                : `工作区 · ${conversation.workdir}`
            }
          >
            {isSshWorkdir(conversation.workdir) ? <Server className="ic" /> : <Folder className="ic" />}
            <span className="sandbox-status-dot" aria-hidden />
          </span>
        ) : (
          <span
            className="sandbox-status chat-sandbox"
            data-tip={sandboxLabel ? `沙箱 · ${sandboxLabel}` : '沙箱'}
            aria-label={sandboxLabel ? `沙箱 · ${sandboxLabel}` : '沙箱'}
          >
            <Box className="ic" />
            <span className="sandbox-status-dot" aria-hidden />
          </span>
        )}
        <WidthPicker
          value={contentWidth}
          open={popover === 'width'}
          onToggle={() => onPopover(popover === 'width' ? null : 'width')}
          onSelect={(w) => {
            onContentWidth(w)
            onPopover(null)
          }}
        />
        <ModelPicker
          models={models}
          currentId={currentModelId}
          open={popover === 'model'}
          onToggle={() => onPopover(popover === 'model' ? null : 'model')}
          onSelect={(id) => {
            onSelectModel(id)
            onPopover(null)
          }}
        />
        <ShareButton
          link={shareLink}
          open={popover === 'share'}
          onToggle={() => onPopover(popover === 'share' ? null : 'share')}
        />
        <button
          className={`icon-btn${archived ? ' active' : ''}`}
          title={archived ? '取消归档' : '归档对话'}
          onClick={onToggleArchive}
        >
          {archived ? <ArchiveRestore className="ic" /> : <Archive className="ic" />}
        </button>
        <button className="icon-btn" title="删除对话" onClick={onDelete}>
          <Trash2 className="ic" />
        </button>
        <button className="icon-btn" title="任务面板" onClick={onTogglePanel}>
          <PanelRight className="ic" />
        </button>
      </div>
    </div>
  )
}, (prev, next) => {
  const a = prev.conversation
  const b = next.conversation
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.workdir === b.workdir &&
    a.activeNodeId === b.activeNodeId &&
    !!a.archived === !!b.archived &&
    prev.currentModelId === next.currentModelId &&
    prev.contentWidth === next.contentWidth &&
    prev.popover === next.popover &&
    prev.sshStatus === next.sshStatus &&
    prev.models === next.models &&
    prev.onPopover === next.onPopover &&
    prev.onToggleSidebar === next.onToggleSidebar &&
    prev.onTogglePanel === next.onTogglePanel &&
    prev.onRename === next.onRename &&
    prev.onSelectModel === next.onSelectModel &&
    prev.onContentWidth === next.onContentWidth &&
    prev.onBindWorkdir === next.onBindWorkdir &&
    prev.onToggleArchive === next.onToggleArchive &&
    prev.onDelete === next.onDelete
  )
})

import {
  Archive,
  ArchiveRestore,
  Box,
  Folder,
  MessageCircle,
  PanelLeft,
  PanelRight,
  Trash2,
} from 'lucide-react'
import type { ContentWidth, Conversation, ModelConfig } from '@yagent/core'
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
}

export function Topbar({
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
}: TopbarProps) {
  // 分享链接 = 当前分支的只读快照 /s/{convId}-{snapshotId}
  const shareLink = `https://yagent.app/s/${conversation.id}-${conversation.activeNodeId.slice(-4) || 'snap'}`
  const archived = !!conversation.archived

  return (
    <div className="topbar">
      <button className="icon-btn" title="侧栏 (⌘B)" onClick={onToggleSidebar}>
        <PanelLeft className="ic" />
      </button>
      <EditableTitle title={conversation.title} onCommit={onRename} />
      <span className="sep">·</span>
      <span className="meta" onClick={onBindWorkdir} style={{ cursor: 'pointer' }} title="点击选择工作目录">
        {conversation.workdir ? (
          <>
            <Folder className="ic ic-sm" />
            <span>{conversation.workdir}</span>
          </>
        ) : (
          <>
            <MessageCircle className="ic ic-sm" />
            <span>chat</span>
          </>
        )}
      </span>
      <div className="topbar-right">
        {conversation.workdir ? (
          <span
            className="sandbox-status"
            data-tip={`沙箱已连接 · ${conversation.workdir}`}
            aria-label={`沙箱已连接 · ${conversation.workdir}`}
          >
            <Box className="ic" />
            <span className="sandbox-status-dot" aria-hidden />
          </span>
        ) : null}
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
}

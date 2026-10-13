import { Folder, MessageCircle, PanelLeft, PanelRight } from 'lucide-react'
import type { Conversation, ModelConfig } from '@yagent/core'
import { EditableTitle } from './EditableTitle'
import { ModelPicker } from './ModelPicker'
import { ShareButton } from './ShareButton'

export type PopoverId = 'model' | 'share' | 'mode' | null

interface TopbarProps {
  conversation: Conversation
  models: ModelConfig[]
  currentModelId: string
  popover: PopoverId
  onPopover: (id: PopoverId) => void
  onToggleSidebar: () => void
  onTogglePanel: () => void
  onRename: (title: string) => void
  onSelectModel: (id: string) => void
}

export function Topbar({
  conversation,
  models,
  currentModelId,
  popover,
  onPopover,
  onToggleSidebar,
  onTogglePanel,
  onRename,
  onSelectModel,
}: TopbarProps) {
  // 分享链接 = 当前分支的只读快照 /s/{convId}-{snapshotId}
  const shareLink = `https://yagent.app/s/${conversation.id}-${conversation.activeNodeId.slice(-4) || 'snap'}`

  return (
    <div className="topbar">
      <button className="icon-btn" title="侧栏 (⌘B)" onClick={onToggleSidebar}>
        <PanelLeft className="ic" />
      </button>
      <EditableTitle title={conversation.title} onCommit={onRename} />
      <span className="sep">·</span>
      <span className="meta">
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
        <div className="pill">
          <span className="ok-dot"></span>沙箱已连接
        </div>
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
        <button className="theme-toggle" title="任务面板" onClick={onTogglePanel}>
          <PanelRight className="ic" />
        </button>
      </div>
    </div>
  )
}

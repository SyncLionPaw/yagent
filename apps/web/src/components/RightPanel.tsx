import { File, FileCode, Image as ImageIcon } from 'lucide-react'
import type { Conversation } from '@yagent/core'
import { formatSize } from '../lib/utils'
import { BranchTree } from './BranchTree'

export type PanelTab = 'task' | 'files' | 'search'

interface RightPanelProps {
  conversation: Conversation
  tab: PanelTab
  activeSrcId: number | null
  onTabChange: (tab: PanelTab) => void
  onSelectNode: (nodeId: string) => void
  onSelectSrc: (id: number) => void
}

function fileIcon(name: string) {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return <ImageIcon className="ic ic-sm" />
  if (/\.(ts|tsx|js|jsx|css|html|sql)$/i.test(name)) return <FileCode className="ic ic-sm" />
  return <File className="ic ic-sm" />
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'task', label: '分支' },
  { id: 'files', label: '文件' },
  { id: 'search', label: '搜索' },
]

export function RightPanel({
  conversation,
  tab,
  activeSrcId,
  onTabChange,
  onSelectNode,
  onSelectSrc,
}: RightPanelProps) {
  return (
    <aside className="panel">
      <div className="panel-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`ptab${tab === t.id ? ' active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={`p-pane${tab === 'task' ? ' active' : ''}`}>
        <BranchTree
          nodes={conversation.nodes}
          activeNodeId={conversation.activeNodeId}
          onSelect={onSelectNode}
        />
      </div>

      <div className={`p-pane pane-files${tab === 'files' ? ' active' : ''}`}>
        <div className="files-half">
          <div className="sub-label">
            用户附件 <span style={{ fontWeight: 400 }}>· 你上传的</span>
          </div>
          {conversation.attachments.map((f) => (
            <div className="sfile" key={f.name}>
              {fileIcon(f.name)}
              <span className="sf-name">{f.name}</span>
              <span className="sf-meta">{formatSize(f.size)}</span>
            </div>
          ))}
        </div>

        <div className="files-divider"></div>

        <div className="files-half">
          <div className="sub-label">
            Agent 产物 <span style={{ fontWeight: 400 }}>· 本次任务生成</span>
          </div>
          {conversation.outputs.map((f) => (
            <div className="sfile" key={f.name}>
              {fileIcon(f.name)}
              <span className="sf-name">{f.name}</span>
              <span className="sf-meta">{formatSize(f.size)}</span>
            </div>
          ))}
        </div>

        <div className="files-note">
          仅展示你上传的附件和 Agent 产出的文件，不是完整的沙箱文件系统。
        </div>
      </div>

      <div className={`p-pane${tab === 'search' ? ' active' : ''}`}>
        {conversation.refs.map((r) => (
          <div
            key={r.id}
            className={`src${activeSrcId === r.id ? ' active' : ''}`}
            onClick={() => onSelectSrc(r.id)}
          >
            <div className="src-title">
              <span className="src-num">{r.id}</span>
              {r.title}
            </div>
            <div className="src-url">{r.url}</div>
            <div className="src-snippet">{r.snippet}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}

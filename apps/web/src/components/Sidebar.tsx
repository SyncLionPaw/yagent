import { Moon, Plus, Settings as SettingsIcon, Sun } from 'lucide-react'
import type { Conversation } from '@yagent/core'
import { formatSidebarTime, groupOf } from '../lib/utils'

interface SidebarProps {
  conversations: Conversation[]
  activeId: string
  theme: 'light' | 'dark'
  onSelect: (id: string) => void
  onNewTask: () => void
  onToggleTheme: () => void
  onOpenSettings: () => void
}

const DOT_CLASS: Record<Conversation['status'], string> = {
  running: 'dot dot-run',
  waiting: 'dot dot-wait',
  done: 'dot dot-done',
}

// 空会话（新建任务）没有节点，记录首次见到的时间作为分组/显示基准
const emptyConvTs = new Map<string, number>()
function emptyConvFallback(id: string): number {
  let ts = emptyConvTs.get(id)
  if (!ts) {
    ts = Date.now()
    emptyConvTs.set(id, ts)
  }
  return ts
}

export function Sidebar({
  conversations,
  activeId,
  theme,
  onSelect,
  onNewTask,
  onToggleTheme,
  onOpenSettings,
}: SidebarProps) {
  const groups: { label: string; items: Conversation[] }[] = []
  const convTs = (conv: Conversation) => {
    const ts = Object.values(conv.nodes).map((n) => n.createdAt)
    return ts.length ? Math.max(...ts) : emptyConvFallback(conv.id)
  }
  for (const conv of conversations) {
    const label = groupOf(conv.status, convTs(conv))
    let group = groups.find((g) => g.label === label)
    if (!group) {
      group = { label, items: [] }
      groups.push(group)
    }
    group.items.push(conv)
  }
  const order = ['进行中', '今天', '更早']
  groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))

  const convTime = (conv: Conversation) => formatSidebarTime(convTs(conv))

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="wordmark">
          <b>y</b>agent
        </span>
      </div>

      <button className="new-task" onClick={onNewTask}>
        <Plus className="ic" />
        <span>新建任务</span>
        <span className="kbd">⌘N</span>
      </button>

      <div className="sidebar-scroll">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((conv) => (
              <div
                key={conv.id}
                className={`conv${conv.id === activeId ? ' active' : ''}`}
                onClick={() => onSelect(conv.id)}
              >
                <span className={DOT_CLASS[conv.status]}></span>
                <span className="title">{conv.title}</span>
                <span className="time">{convTime(conv)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-footer" onClick={onOpenSettings}>
        <div className="avatar">G</div>
        <div className="ws">
          工作区<small>~/yagent</small>
        </div>
        <div className="footer-actions">
          <button
            className="icon-btn"
            title="切换主题"
            onClick={(e) => {
              e.stopPropagation()
              onToggleTheme()
            }}
          >
            {theme === 'dark' ? <Sun className="ic" /> : <Moon className="ic" />}
          </button>
          <button className="icon-btn" title="设置">
            <SettingsIcon className="ic" />
          </button>
        </div>
      </div>
    </aside>
  )
}

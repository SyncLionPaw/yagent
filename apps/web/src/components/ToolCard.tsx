import { useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  CircleHelp,
  FilePen,
  FileText,
  Globe,
  Lightbulb,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'
import { toolFace } from '../lib/processView'

interface ToolCardProps {
  tool: string
  summary: string
  status: 'running' | 'done' | 'error'
  detail?: string
  stats?: string
  input?: Record<string, unknown>
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  run_command: Terminal,
  read_file: FileText,
  write_file: FilePen,
  search_web: Search,
  fetch_url: Globe,
  ask_user_question: CircleHelp,
  load_skill: BookOpen,
  save_insight: Lightbulb,
}

/** 工具一行：动作名 + 参数摘要。和思考一样不套卡片，展开后是输出。 */
export function ToolCard({ tool, summary, status, detail, stats, input }: ToolCardProps) {
  const [open, setOpen] = useState(false)
  const face = toolFace(tool, summary, status, detail, input)
  const Icon = TOOL_ICONS[tool] ?? Wrench
  const shown = open && face.expandable

  return (
    <div className={`tool is-plain tone-${face.tone}${shown ? ' open' : ''}`}>
      <div
        className={`tool-row${face.expandable ? ' can-open' : ''}`}
        role={face.expandable ? 'button' : undefined}
        tabIndex={face.expandable ? 0 : undefined}
        aria-expanded={face.expandable ? shown : undefined}
        onClick={() => face.expandable && setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (!face.expandable) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setOpen((v) => !v)
        }}
      >
        <span className="t-icon">
          <Icon className="ic ic-sm" />
        </span>
        <span className="t-name">{face.label}</span>
        <span
          className={`t-desc${face.tone === 'running' ? ' live' : ''}${face.tone === 'error' && face.exitCode === null ? ' is-error' : ''}${face.tone === 'stopped' ? ' is-stopped' : ''}`}
          title={face.command && face.command !== face.summary ? face.command : face.summary}
        >
          {face.summary}
        </span>
        <span className="t-end">
          {face.tone === 'running' && (
            <span className="t-status">
              <span className="running">
                <span className="ring" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                运行中
              </span>
            </span>
          )}
          {face.tone !== 'running' && stats ? <span className={`t-time tone-${face.tone}`}>{stats}</span> : null}
          {face.expandable && (
            <span className="caret">
              <ChevronDown className="ic ic-sm" />
            </span>
          )}
        </span>
      </div>
      {shown && face.output && (
        <div className="tool-detail">
          <pre className={face.tone === 'error' && !face.terminal ? 'is-error' : undefined}>{face.output}</pre>
        </div>
      )}
    </div>
  )
}

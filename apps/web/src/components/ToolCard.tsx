import { useState } from 'react'
import { Check, FilePen, Globe, Search, Terminal, Wrench } from 'lucide-react'

interface ToolCardProps {
  tool: string
  summary: string
  status: 'running' | 'done' | 'error'
  detail?: string
  stats?: string
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Edit: FilePen,
  Write: FilePen,
  Read: FilePen,
  Search: Search,
  WebSearch: Globe,
}

/** 工具调用卡片：单行极简，点击展开详情（命令输出 / diff） */
export function ToolCard({ tool, summary, status, detail, stats }: ToolCardProps) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICONS[tool] ?? Wrench

  return (
    <div className="tool">
      <div className="tool-row" onClick={() => detail && setOpen((v) => !v)}>
        <span className="t-icon">
          <Icon className="ic ic-sm" />
        </span>
        <span className="t-name">{tool}</span>
        <span className="t-desc">{summary}</span>
        <span className="t-status">
          {status === 'done' && (
            <span className="ok">
              {stats?.startsWith('+') ? null : <Check className="ic ic-sm" />}
              {stats}
            </span>
          )}
          {status === 'running' && (
            <span className="running">
              <span className="ring" style={{ width: 11, height: 11, borderWidth: 1.5 }}></span>
              运行中
            </span>
          )}
          {status === 'error' && <span style={{ color: 'var(--red)' }}>失败</span>}
        </span>
      </div>
      {open && detail && (
        <div className="tool-detail">
          {detail.split('\n').map((line, i) => {
            const cls = line.startsWith('+')
              ? 'dl dl-add'
              : line.startsWith('-')
                ? 'dl dl-del'
                : 'dl dl-ctx'
            return (
              <span key={i} className={cls}>
                {line}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

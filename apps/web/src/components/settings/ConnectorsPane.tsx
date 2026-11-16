import { useState } from 'react'
import {
  BookOpen,
  Code2,
  HardDrive,
  Hash,
  Layers,
  PenTool,
  Plus,
} from 'lucide-react'

/* ---------- 3. 连接器（外部服务，Claude Connectors 风格） ---------- */

interface ConnectorDef {
  id: string
  name: string
  desc: string
  icon: typeof Code2
  color: string // 品牌色徽章
}

const CONNECTORS: ConnectorDef[] = [
  { id: 'github', name: 'GitHub', desc: '读写仓库、Issue 与 Pull Request', icon: Code2, color: '#24292f' },
  { id: 'notion', name: 'Notion', desc: '检索和更新文档、知识库', icon: BookOpen, color: '#000000' },
  { id: 'gdrive', name: 'Google Drive', desc: '读取云盘文件与表格', icon: HardDrive, color: '#1fa463' },
  { id: 'figma', name: 'Figma', desc: '读取设计稿与组件信息', icon: PenTool, color: '#a259ff' },
  { id: 'slack', name: 'Slack', desc: '检索消息、发送通知', icon: Hash, color: '#e01e5a' },
  { id: 'linear', name: 'Linear', desc: '查询和更新问题单', icon: Layers, color: '#5e6ad2' },
]

/** 连接器：本期仅 UI 演示，连接状态存本地 state，未接真实 OAuth/MCP */
export function ConnectorsPane() {
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setConnected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <div className="sub-label">可用服务</div>
      {CONNECTORS.map((c) => {
        const Icon = c.icon
        const on = connected.has(c.id)
        return (
          <div className="row-card" key={c.id}>
            <span className="file-badge" style={{ background: c.color, color: '#fff' }}>
              <Icon className="ic ic-sm" />
            </span>
            <div className="rc-main">
              <div className="rc-title">
                {c.name} {on && <span className="tag-ok">已连接</span>}
              </div>
              <div className="rc-sub">{c.desc}</div>
            </div>
            <div className="rc-actions">
              <button className="btn" onClick={() => toggle(c.id)}>
                {on ? '断开' : '连接'}
              </button>
            </div>
          </div>
        )
      })}

      <div className="sub-label">自定义 MCP 服务器</div>
      <div className="field">
        <div className="field-label">
          服务器地址 <span className="hint">stdio / SSE / HTTP</span>
        </div>
        <input type="text" placeholder="https://mcp.example.com/sse" disabled />
      </div>
      <button className="btn" disabled>
        <Plus className="ic ic-sm" />
        添加（即将支持）
      </button>

      <div className="files-note" style={{ marginTop: 16 }}>
        连接器为预览功能：连接状态仅本地演示，真实授权（OAuth）与 MCP 接入尚未实现。
      </div>
    </>
  )
}


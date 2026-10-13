import type { ConversationNode } from '@yagent/core'

/** 根到 activeNodeId 的路径 */
export function pathToActive(
  nodes: Record<string, ConversationNode>,
  activeNodeId: string,
): ConversationNode[] {
  const path: ConversationNode[] = []
  let cur: ConversationNode | undefined = nodes[activeNodeId]
  let guard = 0
  while (cur && guard++ < 10_000) {
    path.unshift(cur)
    cur = cur.parentId ? nodes[cur.parentId] : undefined
  }
  return path
}

export function childrenMap(nodes: Record<string, ConversationNode>): Map<string, string[]> {
  // 保持插入序：第一个 child 是主干延续（分叉时 = 分支A）
  const map = new Map<string, string[]>()
  for (const n of Object.values(nodes)) {
    if (!n.parentId) continue
    const arr = map.get(n.parentId) ?? []
    arr.push(n.id)
    map.set(n.parentId, arr)
  }
  return map
}

/** 主干 = 从根开始始终走第一个 child 的链 */
export function trunkIds(nodes: Record<string, ConversationNode>): Set<string> {
  const kids = childrenMap(nodes)
  const set = new Set<string>()
  let cur = Object.values(nodes).find((n) => n.parentId === null)
  while (cur) {
    set.add(cur.id)
    const next = kids.get(cur.id)?.[0]
    cur = next ? nodes[next] : undefined
  }
  return set
}

export function hasChildren(nodes: Record<string, ConversationNode>, id: string): boolean {
  return Object.values(nodes).some((n) => n.parentId === id)
}

/** 节点标签：取首个 text 块，去掉行内标记后截断 */
export function nodeLabel(node: ConversationNode, max = 14): string {
  const text = node.blocks.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return node.role === 'user' ? '消息' : '回复'
  const clean = text.text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/* ---------- 时间 / 大小格式化 ---------- */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 消息头部时间：今天 HH:MM，昨天“昨天”，更早显示星期 */
export function formatMsgTime(ts: number, now = Date.now()): string {
  if (isSameDay(ts, now)) return hhmm(ts)
  if (isSameDay(ts, now - 86400_000)) return '昨天'
  return WEEKDAYS[new Date(ts).getDay()]
}

/** 侧栏时间：2h 内相对时间，今天 HH:MM，昨天/星期 */
export function formatSidebarTime(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return '1m'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 2 * 3600_000) return `${Math.floor(diff / 3600_000)}h`
  return formatMsgTime(ts, now)
}

/** 侧栏分组：进行中 / 今天 / 更早 */
export function groupOf(status: string, ts: number, now = Date.now()): string {
  if (status === 'running' || status === 'waiting') return '进行中'
  if (isSameDay(ts, now)) return '今天'
  return '更早'
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

export function formatDaysAgo(ts: number, now = Date.now()): string {
  const days = Math.max(0, Math.round((now - ts) / 86400_000))
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

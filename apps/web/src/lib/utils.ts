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

/* ---------- 文件类型（附件气泡 / 徽章着色共用） ---------- */

export type FileKind = 'image' | 'code' | 'doc' | 'sheet' | 'archive' | 'media' | 'file'

export function fileKindOf(name: string): FileKind {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name)) return 'image'
  if (/\.(ts|tsx|js|jsx|css|html|sql|py|rs|go|java|c|cpp|h|json|ya?ml|sh|toml)$/i.test(name)) return 'code'
  if (/\.(txt|md|pdf|docx?|rtf)$/i.test(name)) return 'doc'
  if (/\.(csv|tsv|xlsx?|numbers)$/i.test(name)) return 'sheet'
  if (/\.(zip|tar|gz|rar|7z)$/i.test(name)) return 'archive'
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) return 'media'
  if (/\.(mp4|mov|webm|mkv|avi)$/i.test(name)) return 'media'
  return 'file'
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

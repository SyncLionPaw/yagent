import type { Conversation, ConversationNode } from '@yagent/core'

export type TokenBucket = {
  input: number
  output: number
}

export type UsageEvent = {
  t: number
  input: number
  output: number
}

export type TokenUsageStore = {
  /** 原始事件（保留近 7 天）；旧版 days 读入时会迁移 */
  events: UsageEvent[]
  /** @deprecated 仅兼容旧文件 */
  days?: Record<string, TokenBucket>
}

export type TokenRangeId = '1h' | '12h' | '3d' | '7d'

export const TOKEN_RANGES: { id: TokenRangeId; label: string; ms: number; bucketMs: number }[] = [
  { id: '1h', label: '1 小时内', ms: 3_600_000, bucketMs: 5 * 60_000 },
  { id: '12h', label: '12 小时内', ms: 12 * 3_600_000, bucketMs: 60 * 60_000 },
  { id: '3d', label: '3 天', ms: 3 * 86_400_000, bucketMs: 6 * 3_600_000 },
  { id: '7d', label: '7 天', ms: 7 * 86_400_000, bucketMs: 12 * 3_600_000 },
]

const LS_KEY = 'yagent-token-usage'
const RETAIN_MS = 7 * 86_400_000
const emptyStore = (): TokenUsageStore => ({ events: [] })

function createStorage() {
  const ipc = window.yagentDesktop?.usage
  if (ipc) {
    return {
      async read(): Promise<string | null> {
        const content = await ipc.read()
        if (content !== null) return content
        try {
          return localStorage.getItem(LS_KEY)
        } catch {
          return null
        }
      },
      write(content: string) {
        return ipc.write(content)
      },
    }
  }
  return {
    async read(): Promise<string | null> {
      try {
        return localStorage.getItem(LS_KEY)
      } catch {
        return null
      }
    },
    async write(content: string) {
      try {
        localStorage.setItem(LS_KEY, content)
      } catch {
        /* ignore */
      }
    },
  }
}

const storage = createStorage()
let cache: TokenUsageStore | null = null
let writeChain: Promise<void> = Promise.resolve()

function pruneEvents(events: UsageEvent[], now = Date.now()): UsageEvent[] {
  const cut = now - RETAIN_MS
  return events.filter((e) => e.t >= cut)
}

function parseStore(raw: string | null): TokenUsageStore {
  if (!raw) return emptyStore()
  try {
    const data = JSON.parse(raw) as TokenUsageStore
    if (!data || typeof data !== 'object') return emptyStore()
    const events: UsageEvent[] = Array.isArray(data.events)
      ? data.events.filter(
          (e) =>
            e &&
            typeof e.t === 'number' &&
            typeof e.input === 'number' &&
            typeof e.output === 'number',
        )
      : []
    // 旧版按日累加 → 落到当天正午的一条事件
    if (events.length === 0 && data.days && typeof data.days === 'object') {
      for (const [key, v] of Object.entries(data.days)) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
        if (!m || !v) continue
        const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).getTime()
        events.push({
          t,
          input: Math.max(0, Math.floor(v.input) || 0),
          output: Math.max(0, Math.floor(v.output) || 0),
        })
      }
    }
    return { events: pruneEvents(events) }
  } catch {
    return emptyStore()
  }
}

export async function loadTokenUsage(): Promise<TokenUsageStore> {
  if (cache) return cache
  cache = parseStore(await storage.read())
  return cache
}

function scheduleSave(store: TokenUsageStore) {
  cache = store
  const json = JSON.stringify({ events: store.events })
  writeChain = writeChain.then(() => storage.write(json)).catch(() => {})
}

/** 记录一次 API usage */
export async function recordTokenUsage(usage: { input: number; output: number }): Promise<void> {
  const input = Math.max(0, Math.floor(usage.input) || 0)
  const output = Math.max(0, Math.floor(usage.output) || 0)
  if (!input && !output) return
  const store = await loadTokenUsage()
  store.events = pruneEvents([...store.events, { t: Date.now(), input, output }])
  scheduleSave(store)
}

/** 粗估：CJK ≈ 1.5 字/token，其它 ≈ 4 字/token */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp > 0x2e80) cjk += 1
    else if (ch.trim()) other += 1
  }
  return Math.ceil(cjk / 1.5 + other / 4)
}

function blockText(block: ConversationNode['blocks'][number]): string {
  if (block.type === 'text' || block.type === 'thinking') return block.text
  if (block.type === 'tool_result') return block.content
  if (block.type === 'tool') {
    return `${block.summary}\n${block.detail ?? ''}\n${JSON.stringify(block.input ?? {})}`
  }
  return ''
}

/** 从会话树估算为事件列表（无 API 计量时的兜底） */
export function estimateEventsFromConversations(conversations: Conversation[]): UsageEvent[] {
  const events: UsageEvent[] = []
  for (const c of conversations) {
    for (const n of Object.values(c.nodes)) {
      let input = 0
      let output = 0
      if (n.role === 'user') {
        for (const b of n.blocks) input += estimateTokens(blockText(b))
      } else if (n.role === 'agent') {
        for (const b of n.blocks) output += estimateTokens(blockText(b))
      } else {
        n.blocks.forEach((b, i) => {
          const tok = estimateTokens(blockText(b))
          if (i === 0 || b.type === 'tool_result') input += tok
          else output += tok
        })
      }
      if (input || output) events.push({ t: n.createdAt, input, output })
    }
  }
  return pruneEvents(events)
}

export function sumBuckets(buckets: TokenBucket[]): TokenBucket {
  let input = 0
  let output = 0
  for (const d of buckets) {
    input += d.input
    output += d.output
  }
  return { input, output }
}

export function sumEvents(events: UsageEvent[]): TokenBucket {
  return sumBuckets(events)
}

/** 把事件聚合成等距时间桶（用于面积图） */
export function bucketEvents(
  events: UsageEvent[],
  range: (typeof TOKEN_RANGES)[number],
  now = Date.now(),
): { key: string; t: number; input: number; output: number }[] {
  const start = now - range.ms
  const bucketMs = range.bucketMs
  const count = Math.max(1, Math.round(range.ms / bucketMs))
  const out: { key: string; t: number; input: number; output: number }[] = []
  for (let i = 0; i < count; i++) {
    const t0 = start + i * bucketMs
    out.push({ key: String(t0), t: t0, input: 0, output: 0 })
  }
  for (const e of events) {
    if (e.t < start || e.t > now) continue
    const idx = Math.min(count - 1, Math.max(0, Math.floor((e.t - start) / bucketMs)))
    const b = out[idx]!
    b.input += e.input
    b.output += e.output
  }
  return out
}

export function formatTok(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${Math.round(n / 1_000_000)}M`
}

/** 轴 / tip 时间标签 */
export function formatBucketLabel(t: number, rangeId: TokenRangeId): string {
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (rangeId === '1h' || rangeId === '12h') return `${hh}:${mm}`
  const mon = d.getMonth() + 1
  const day = d.getDate()
  if (rangeId === '3d') return `${mon}/${day} ${hh}:00`
  return `${mon}/${day}`
}

import type { Insight } from '@yagent/core'

export type InsightDraft = {
  title: string
  text: string
  why?: string
  convId?: string
}

type InsightHandler = (draft: InsightDraft) => Promise<Insight>

const LS_PREFIX = 'yagent-insight:'
const LS_INDEX = 'yagent-insight-ids'

let handler: InsightHandler | null = null

export function registerInsightHandler(next: InsightHandler | null): void {
  handler = next
}

export function parseInsightInput(input: Record<string, unknown>): InsightDraft {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  const why = typeof input.why === 'string' ? input.why.trim() : undefined
  if (!title) throw new Error('save_insight 需要 title')
  if (!text) throw new Error('save_insight 需要 text')
  return {
    title: title.slice(0, 24),
    text: text.slice(0, 280),
    ...(why ? { why: why.slice(0, 120) } : {}),
  }
}

export async function requestSaveInsight(
  draft: InsightDraft,
  signal?: AbortSignal,
): Promise<Insight> {
  if (signal?.aborted) throw new Error('aborted')
  if (!handler) throw new Error('收获写入未就绪')
  return handler(draft)
}

export function formatInsightResult(insight: Insight): string {
  return `已写入收获「${insight.title}」（右侧面板可查看）`
}

export function newInsightId(): string {
  return `ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function localIndex(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function setLocalIndex(ids: string[]) {
  try {
    localStorage.setItem(LS_INDEX, JSON.stringify(ids))
  } catch {
    //
  }
}

/** 写入收获正文：桌面 → dataDir/insights/<id>.json；浏览器 → localStorage */
export async function writeInsight(insight: Insight): Promise<void> {
  const ipc = window.yagentDesktop?.insights
  if (ipc) {
    await ipc.write(insight)
    return
  }
  try {
    localStorage.setItem(LS_PREFIX + insight.id, JSON.stringify(insight))
    const idx = localIndex()
    if (!idx.includes(insight.id)) setLocalIndex([insight.id, ...idx])
  } catch {
    //
  }
}

export async function readInsights(ids: string[]): Promise<Insight[]> {
  const list = ids.filter(Boolean)
  if (!list.length) return []
  const ipc = window.yagentDesktop?.insights
  if (ipc) return ipc.readMany(list)

  const out: Insight[] = []
  for (const id of list) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + id)
      if (!raw) continue
      const obj = JSON.parse(raw) as Insight
      if (obj && typeof obj.id === 'string') out.push(obj)
    } catch {
      //
    }
  }
  return out
}

export async function deleteInsight(id: string): Promise<void> {
  const ipc = window.yagentDesktop?.insights
  if (ipc) {
    await ipc.delete(id)
    return
  }
  try {
    localStorage.removeItem(LS_PREFIX + id)
    setLocalIndex(localIndex().filter((x) => x !== id))
  } catch {
    //
  }
}

export async function deleteInsights(ids: string[]): Promise<void> {
  const list = ids.filter(Boolean)
  if (!list.length) return
  const ipc = window.yagentDesktop?.insights
  if (ipc) {
    await ipc.deleteMany(list)
    return
  }
  for (const id of list) await deleteInsight(id)
}

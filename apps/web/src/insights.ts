import type { Insight, InsightCategory, InsightMark } from '@yagent/core'

export type InsightDraft = {
  title: string
  text: string
  category: InsightCategory
  why?: string
  convId?: string
}

type InsightHandler = (draft: InsightDraft) => Promise<Insight>

const LS_PREFIX = 'yagent-insight:'
const LS_INDEX = 'yagent-insight-ids'
const LS_SIGHT = 'yagent-insight-sight-ids'

let handler: InsightHandler | null = null

export function registerInsightHandler(next: InsightHandler | null): void {
  handler = next
}

function parseCategory(raw: unknown): InsightCategory {
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 32)
  return '未分类'
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
    category: parseCategory(input.category),
    ...(why ? { why: why.slice(0, 120) } : {}),
  }
}

/** 读盘时补齐旧数据缺省类别 */
export function normalizeInsight(raw: Insight): Insight {
  return {
    ...raw,
    category: parseCategory(raw.category),
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
  return `已写入收获「${insight.title}」（右侧面板可筛选）`
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

function localSightIndex(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SIGHT) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function setLocalSightIndex(ids: string[]) {
  try {
    localStorage.setItem(LS_SIGHT, JSON.stringify(ids))
  } catch {
    //
  }
}

function syncLocalSight(insight: Insight) {
  const idx = localSightIndex()
  if (insight.mark === 'keep') {
    if (!idx.includes(insight.id)) setLocalSightIndex([insight.id, ...idx])
  } else {
    setLocalSightIndex(idx.filter((x) => x !== insight.id))
  }
}

/** 写入收获正文：桌面 → dataDir/insights/<id>.json（收藏同步 sight/）；浏览器 → localStorage */
export async function writeInsight(insight: Insight): Promise<void> {
  const next = normalizeInsight(insight)
  const ipc = window.yagentDesktop?.insights
  if (ipc) {
    await ipc.write(next)
    return
  }
  try {
    localStorage.setItem(LS_PREFIX + next.id, JSON.stringify(next))
    const idx = localIndex()
    if (!idx.includes(next.id)) setLocalIndex([next.id, ...idx])
    syncLocalSight(next)
  } catch {
    //
  }
}

/** 更新打标；`mark` 为 null 时清回待看 */
export async function markInsight(
  insight: Insight,
  mark: InsightMark | null,
): Promise<Insight> {
  const next: Insight = { ...normalizeInsight(insight) }
  if (mark) next.mark = mark
  else delete next.mark
  await writeInsight(next)
  return next
}

export async function readInsights(ids: string[]): Promise<Insight[]> {
  const list = ids.filter(Boolean)
  if (!list.length) return []
  const ipc = window.yagentDesktop?.insights
  const rawList = ipc
    ? await ipc.readMany(list)
    : (() => {
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
      })()
  return rawList.map(normalizeInsight)
}

/** 收藏库：桌面读 insights/sight/；浏览器按 sight 索引 */
export async function listSightInsights(): Promise<Insight[]> {
  const ipc = window.yagentDesktop?.insights
  if (ipc?.listSight) {
    const list = await ipc.listSight()
    return list.map(normalizeInsight)
  }

  const out: Insight[] = []
  for (const id of localSightIndex()) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + id)
      if (!raw) continue
      const obj = JSON.parse(raw) as Insight
      if (obj && typeof obj.id === 'string' && obj.mark === 'keep') {
        out.push(normalizeInsight(obj))
      }
    } catch {
      //
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

export async function deleteInsight(
  id: string,
  opts?: { preserveSight?: boolean },
): Promise<void> {
  const ipc = window.yagentDesktop?.insights
  if (ipc) {
    await ipc.delete(id, opts)
    return
  }
  try {
    localStorage.removeItem(LS_PREFIX + id)
    setLocalIndex(localIndex().filter((x) => x !== id))
    if (!opts?.preserveSight) {
      setLocalSightIndex(localSightIndex().filter((x) => x !== id))
    }
  } catch {
    //
  }
}

export async function deleteInsights(
  ids: string[],
  opts?: { preserveSight?: boolean },
): Promise<void> {
  const list = ids.filter(Boolean)
  if (!list.length) return
  for (const id of list) await deleteInsight(id, opts)
}

export function categoryMatches(insightCat: string, keyword: string): boolean {
  return insightCat.trim().toLowerCase() === keyword.trim().toLowerCase()
}

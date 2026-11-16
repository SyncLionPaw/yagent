import type { ContextSnapshot } from '@yagent/core'
import type { ContextMeter } from '../components/Composer'
import { harness } from '../harness'

export function clampPanelW(
  raw: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function formatTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(Math.round(n))
}

/** 分段色：接近 Cursor Context Usage 面板的区分度 */
const CTX_COLORS = {
  system: '#8b8b96',
  tools: '#7c6cf0',
  conversation: '#e85d4c',
  toolResults: '#c44d7a',
} as const

export function readContextSnapshot(convId: string): ContextSnapshot | null {
  if (!convId || !harness.getConversation(convId)) return null
  try {
    return harness.getContextSnapshot(convId)
  } catch {
    return null
  }
}

export function toContextMeter(snap: ContextSnapshot): ContextMeter {
  const limit = Math.max(1, snap.limit || 128_000)
  const estimated = Math.max(0, snap.estimated || 0)
  const ratio = snap.ratio ?? estimated / limit
  const pct = Math.round(Math.min(Math.max(ratio, 0), 9.99) * 100)
  const b = snap.breakdown ?? { system: 0, tools: 0, messages: estimated, toolResults: 0 }
  const toolResults = Math.min(b.toolResults || 0, b.messages || 0)
  const conversationTok = Math.max(0, (b.messages || 0) - toolResults)
  const segments: ContextMeter['segments'] = [
    { id: 'system', label: '系统提示', tokens: b.system || 0, color: CTX_COLORS.system },
    { id: 'tools', label: '工具定义', tokens: b.tools || 0, color: CTX_COLORS.tools },
    { id: 'conversation', label: '对话', tokens: conversationTok, color: CTX_COLORS.conversation },
  ]
  if (toolResults > 0) {
    segments.push({
      id: 'toolResults',
      label: '工具结果',
      tokens: toolResults,
      color: CTX_COLORS.toolResults,
    })
  }
  const notes: NonNullable<ContextMeter['notes']> = []
  if (snap.lastUsage?.cacheRead != null) {
    notes.push({
      label: '缓存命中',
      value:
        snap.cacheHitRatio != null
          ? `${formatTok(snap.lastUsage.cacheRead)} · ${Math.round(snap.cacheHitRatio * 100)}%`
          : formatTok(snap.lastUsage.cacheRead),
    })
  }
  if (snap.lastUsage?.cacheWrite != null && snap.lastUsage.cacheWrite > 0) {
    notes.push({ label: '缓存写入', value: formatTok(snap.lastUsage.cacheWrite) })
  }
  if (snap.trimmed && snap.trimmedTokens > 0) {
    notes.push({ label: '已裁剪', value: `约 ${formatTok(snap.trimmedTokens)}` })
  }
  return {
    ratio,
    limit,
    pctLabel: `${pct}%`,
    tokensLabel: `~${formatTok(estimated)} / ${formatTok(limit)}`,
    segments: segments.filter((s) => s.tokens > 0),
    ...(notes.length ? { notes } : {}),
  }
}

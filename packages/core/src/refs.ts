/* ============ 回答引用标签：解析 / 合并 / 展示改写 ============
 * 模型在正文中插入：
 *   <ref url="https://..." title="短标题">可选摘要</ref>
 *   <ref_link>https://...</ref_link>
 *   <ref_link url="https://..." title="短标题" />
 * UI 改写成 [n] 角标；会话 refs[] 汇总到右栏「搜索」。
 */

import type { Conversation, Ref } from './model.js'

export interface ExtractedRef {
  url: string
  title: string
  snippet: string
}

/** 完整标签（流式未闭合的不匹配，避免半截标签入库） */
const REF_BLOCK =
  /<ref\s+([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/ref\s*>)/gi
const REF_LINK_BLOCK =
  /<ref_link(\s+[^>]*?)?\s*(?:\/>|>([\s\S]*?)<\/ref_link\s*>)/gi

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const m of raw.matchAll(/([:@\w-]+)\s*=\s*"([^"]*)"/g)) {
    out[m[1].toLowerCase()] = m[2].trim()
  }
  for (const m of raw.matchAll(/([:@\w-]+)\s*=\s*'([^']*)'/g)) {
    if (!(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2].trim()
  }
  return out
}

function normalizeUrl(raw: string): string {
  const u = raw.trim()
  if (!u) return ''
  try {
    const parsed = new URL(u.includes('://') ? u : `https://${u}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.href
  } catch {
    return ''
  }
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

function pushRef(list: ExtractedRef[], url: string, title: string, snippet: string): void {
  const href = normalizeUrl(url)
  if (!href) return
  list.push({
    url: href,
    title: (title || titleFromUrl(href)).slice(0, 200),
    snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 400),
  })
}

/** 从一段正文抽出全部完整引用标签（出现顺序） */
export function extractRefs(text: string): ExtractedRef[] {
  const out: ExtractedRef[] = []
  if (!text) return out

  REF_BLOCK.lastIndex = 0
  for (const m of text.matchAll(REF_BLOCK)) {
    const a = parseAttrs(m[1] ?? '')
    const body = (m[2] ?? '').trim()
    pushRef(out, a.url || a.href || '', a.title || a.name || body, a.snippet || body)
  }

  REF_LINK_BLOCK.lastIndex = 0
  for (const m of text.matchAll(REF_LINK_BLOCK)) {
    const a = parseAttrs(m[1] ?? '')
    const body = (m[2] ?? '').trim()
    const url = a.url || a.href || body
    const title = a.title || a.name || ''
    pushRef(out, url, title, a.snippet || '')
  }

  return out
}

/** 按 URL 去重合并；id 从 1 起，保持先出现者编号 */
export function mergeRefs(existing: Ref[], extracted: ExtractedRef[]): Ref[] {
  const byUrl = new Map<string, Ref>()
  for (const r of existing) {
    const href = normalizeUrl(r.url)
    if (href && !byUrl.has(href)) byUrl.set(href, { ...r, url: href })
  }
  for (const e of extracted) {
    const cur = byUrl.get(e.url)
    if (!cur) {
      byUrl.set(e.url, {
        id: 0,
        url: e.url,
        title: e.title,
        snippet: e.snippet,
      })
    } else {
      if (e.title && (cur.title === titleFromUrl(cur.url) || !cur.title)) cur.title = e.title
      if (e.snippet && e.snippet.length > (cur.snippet?.length ?? 0)) cur.snippet = e.snippet
    }
  }
  return [...byUrl.values()].map((r, i) => ({ ...r, id: i + 1 }))
}

/** 把完整引用标签替换成 [n]；未识别 URL 的标签原样保留 */
export function replaceRefTags(text: string, refs: Ref[]): string {
  if (!text) return text
  const idOf = new Map(refs.map((r) => [normalizeUrl(r.url), r.id]))

  const replacer = (attrsRaw: string, body: string | undefined, kind: 'ref' | 'ref_link'): string => {
    const a = parseAttrs(attrsRaw ?? '')
    const bodyTrim = (body ?? '').trim()
    const url =
      kind === 'ref_link' ? a.url || a.href || bodyTrim : a.url || a.href || ''
    const href = normalizeUrl(url)
    const id = href ? idOf.get(href) : undefined
    return id ? `[${id}]` : ''
  }

  let out = text.replace(REF_BLOCK, (_m, attrsRaw: string, body?: string) =>
    replacer(attrsRaw, body, 'ref'),
  )
  out = out.replace(REF_LINK_BLOCK, (_m, attrsRaw: string | undefined, body?: string) =>
    replacer(attrsRaw ?? '', body, 'ref_link'),
  )
  // 流式尾巴：尚未闭合的半截标签先藏起来，避免闪烁
  out = out.replace(/<(ref|ref_link)\b[^>]*$/i, '')
  return out
}

/** 展示用：标签 → [n]，并得到应写入会话的 refs */
export function materializeRefs(
  text: string,
  known: Ref[] = [],
): { text: string; refs: Ref[] } {
  const refs = mergeRefs(known, extractRefs(text))
  return { text: replaceRefTags(text, refs), refs }
}

/** 扫描会话全部正文，重建 conv.refs（工具结果里的裸 URL 不自动进栏，只认标签） */
export function syncConversationRefs(conv: Conversation): boolean {
  const extracted: ExtractedRef[] = []
  for (const node of Object.values(conv.nodes)) {
    for (const b of node.blocks) {
      if (b.type === 'text') extracted.push(...extractRefs(b.text))
    }
  }
  const next = mergeRefs([], extracted)
  const same =
    next.length === conv.refs.length &&
    next.every(
      (r, i) =>
        r.id === conv.refs[i]?.id &&
        r.url === conv.refs[i]?.url &&
        r.title === conv.refs[i]?.title &&
        r.snippet === conv.refs[i]?.snippet,
    )
  if (same) return false
  conv.refs = next
  return true
}

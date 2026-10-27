/* ============ 会话 JSONL 编解码 ============
 * 一行为一条记录：
 *   {"_meta": {...}}   会话元数据（title/workdir/activeNodeId/status/...），浅合并，后写赢
 *   {"id": "u_x", ...} 节点（ConversationNode 原样，parentId 表达树），按 id upsert，后写赢
 * 读 = 逐行 fold；坏行/半行（崩溃截断）跳过。
 */

import type { Conversation, ConversationNode } from '../model.js'

export function metaOf(conv: Conversation): Record<string, unknown> {
  return {
    id: conv.id,
    title: conv.title,
    workdir: conv.workdir,
    activeNodeId: conv.activeNodeId,
    status: conv.status,
    archived: !!conv.archived,
    refs: conv.refs,
    attachments: conv.attachments,
    outputs: conv.outputs,
  }
}

export function metaLineOf(conv: Conversation): string {
  return JSON.stringify({ _meta: metaOf(conv) })
}

/** 整会话 → JSONL 全文（压缩/快照用） */
export function encodeConversation(conv: Conversation): string {
  const lines = [metaLineOf(conv)]
  for (const n of Object.values(conv.nodes)) lines.push(JSON.stringify(n))
  return lines.join('\n') + '\n'
}

/** JSONL 全文 → 会话；元数据缺失返回 null，坏行跳过 */
export function decodeConversation(text: string): Conversation | null {
  // 旧版整文件 JSON（可能 pretty-print 成多行）：先试整段解析
  try {
    const obj = JSON.parse(text) as Record<string, unknown>
    if (obj && typeof obj.id === 'string' && obj.nodes && typeof obj.nodes === 'object') {
      const conv = obj as unknown as Conversation
      if (conv.status !== 'done') conv.status = 'done' // 上次可能死于流式中途
      return conv
    }
  } catch {
    // 不是整文件 JSON，走 JSONL fold
  }
  let meta: Record<string, unknown> | null = null
  const nodes: Record<string, ConversationNode> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let obj: unknown
    try {
      obj = JSON.parse(t)
    } catch {
      continue // 崩溃截断的半行 / 坏行
    }
    if (obj && typeof obj === 'object') {
      const rec = obj as Record<string, unknown>
      if (rec._meta && typeof rec._meta === 'object') {
        meta = { ...(meta ?? {}), ...(rec._meta as Record<string, unknown>) }
      } else if (typeof rec.id === 'string' && rec.nodes && typeof rec.nodes === 'object') {
        // 旧版整文件 JSON（单 blob）：fold 进来，当作一条全量记录
        const { nodes: legacyNodes, ...rest } = rec
        meta = { ...(meta ?? {}), ...rest }
        Object.assign(nodes, legacyNodes)
      } else if (typeof rec.id === 'string' && typeof rec.role === 'string') {
        nodes[rec.id] = obj as ConversationNode
      }
    }
  }
  if (!meta || typeof meta.id !== 'string') return null
  const conv = { ...meta, nodes } as Conversation
  if (conv.status !== 'done') conv.status = 'done' // 上次可能死于流式中途
  return conv
}

/** 文本中的有效行数（压缩阈值估算用） */
export function countLines(text: string): number {
  let n = 0
  for (const line of text.split('\n')) if (line.trim()) n++
  return n
}

/** 工作目录 → 目录 slug（Claude Code 风格：/Users/gyl/yagent → Users-gyl-yagent） */
export function slugifyWorkdir(workdir: string): string {
  const s = workdir
    .replace(/^[a-zA-Z]:/, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'root'
}

/** 会话 → 存储 key（相对路径）：绑定目录的按项目分目录，纯对话进 chats/ */
export function conversationKey(conv: Conversation): string {
  const file = `${conv.id}.jsonl`
  return conv.workdir ? `projects/${slugifyWorkdir(conv.workdir)}/${file}` : `chats/${file}`
}

/* ============ 消息拼装：节点路径 → ChatMessage ============
 * round 节点（一轮问答）：blocks[0] 是用户输入 → user；随后按块类型分流——
 * text/tool_use → assistant，tool_result → user；相邻同角色合并。
 * user/agent 为旧版粒度节点，仅用于兼容已持久化的老会话。
 */

import type { Conversation, ConversationNode } from '../model.js'
import type { ChatMessage, ContentBlock } from '../providers/types.js'
import { pathTo } from './conversation.js'

/** round 节点 → 多条消息（协议要求 tool_result 必须放 user 角色） */
function roundToMessages(node: ConversationNode): ChatMessage[] {
  const msgs: ChatMessage[] = []
  let role: 'user' | 'assistant' = 'user'
  let buf: ContentBlock[] = []
  const flush = (): void => {
    if (buf.length) msgs.push({ role, content: buf })
    buf = []
  }
  for (const [i, b] of node.blocks.entries()) {
    let target: 'user' | 'assistant'
    let block: ContentBlock | null = null
    if (i === 0 && b.type === 'text') {
      target = 'user'
      if (b.text) block = { type: 'text', text: b.text }
    } else if (b.type === 'image') {
      // 用户附件图：紧跟 blocks[0] 文本，走多模态；路径另附文本供 read_file
      target = 'user'
      if (b.data) {
        if (target !== role) {
          flush()
          role = target
        }
        buf.push({ type: 'image', mime: b.mime, data: b.data })
        if (b.path) {
          buf.push({ type: 'text', text: `附件「${b.name}」路径: ${b.path}` })
        }
        continue
      }
    } else if (b.type === 'file') {
      // UI 卡片；正文附注已含内容/路径，不另回放
      continue
    } else if (b.type === 'tool_result') {
      target = 'user'
      block = { type: 'tool_result', toolUseId: b.toolUseId ?? '', content: b.content, isError: b.isError }
    } else {
      target = 'assistant'
      if (b.type === 'text') {
        if (b.text) block = { type: 'text', text: b.text }
      } else if (b.type === 'tool' && b.toolUseId) {
        block = { type: 'tool_use', id: b.toolUseId, name: b.tool, input: b.input ?? {} }
      }
      // thinking / artifacts 不回放
    }
    if (!block) continue
    if (target !== role) {
      flush()
      role = target
    }
    buf.push(block)
  }
  flush()
  return msgs
}

/** 旧版单消息节点 → 0/1 条消息 */
function legacyToMessage(node: ConversationNode): ChatMessage | null {
  const blocks: ContentBlock[] = []
  for (const b of node.blocks) {
    switch (b.type) {
      case 'text':
        if (b.text) blocks.push({ type: 'text', text: b.text })
        break
      case 'thinking':
        break // 不回放（见 providers 转换层）
      case 'tool':
        if (b.toolUseId) blocks.push({ type: 'tool_use', id: b.toolUseId, name: b.tool, input: b.input ?? {} })
        break
      case 'tool_result':
        blocks.push({ type: 'tool_result', toolUseId: b.toolUseId ?? '', content: b.content, isError: b.isError })
        break
      case 'artifacts':
        break
    }
  }
  if (blocks.length === 0) return null
  return { role: node.role === 'user' ? 'user' : 'assistant', content: blocks }
}

/** 根 → activeNode 路径拼成 messages；相邻同角色合并（provider 要求交替） */
export function buildMessages(conv: Conversation): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const node of pathTo(conv, conv.activeNodeId)) {
    const msgs = node.role === 'round' ? roundToMessages(node) : ([legacyToMessage(node)].filter(Boolean) as ChatMessage[])
    for (const msg of msgs) {
      const last = out[out.length - 1]
      if (last && last.role === msg.role && Array.isArray(last.content) && Array.isArray(msg.content)) {
        last.content = [...last.content, ...msg.content]
      } else {
        out.push(msg)
      }
    }
  }
  fillOrphanToolResults(out)
  return out
}

/** 孤儿 tool_use 补占位 tool_result：中断/出错时结果块没落盘，
 *  但协议要求每个 tool_call 都有对应结果，否则 API 400 */
function fillOrphanToolResults(msgs: ChatMessage[]): void {
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    const calls = msg.content.filter((b) => b.type === 'tool_use')
    if (!calls.length) continue
    const next = msgs[i + 1]
    const results =
      next && next.role === 'user' && Array.isArray(next.content) ? next.content : null
    const missing = calls.filter(
      (c) => !results?.some((r) => r.type === 'tool_result' && r.toolUseId === c.id),
    )
    if (!missing.length) continue
    const placeholders: ContentBlock[] = missing.map((c) => ({
      type: 'tool_result',
      toolUseId: c.id,
      content: '[interrupted: no result]',
      isError: true,
    }))
    if (results) results.push(...placeholders)
    else msgs.splice(i + 1, 0, { role: 'user', content: placeholders })
  }
}

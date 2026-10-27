/* ============ 会话 / 树操作纯函数：不依赖 emit，可独立测试 ============ */

import type { Block, Conversation, ConversationNode, Role } from '../model.js'

let counter = 0
export function uid(prefix: string): string {
  counter = (counter + 1) % 0xffff
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function makeNode(role: Role, parentId: string | null, blocks: Block[]): ConversationNode {
  return { id: uid(role === 'user' ? 'u' : 'a'), parentId, role, blocks, createdAt: Date.now() }
}

export function pathTo(conv: Conversation, nodeId: string): ConversationNode[] {
  const path: ConversationNode[] = []
  let id: string | null = nodeId || null
  while (id) {
    const node = conv.nodes[id]
    if (!node) break
    path.push(node)
    id = node.parentId
  }
  return path.reverse()
}

/** 新会话的初始状态对象（emit 由调用方负责） */
export function createConversationState(title: string, workdir: string | null): Conversation {
  return {
    id: uid('conv'),
    title,
    workdir,
    nodes: {},
    activeNodeId: '',
    status: 'done',
    refs: [],
    attachments: [],
    outputs: [],
    insightIds: [],
  }
}

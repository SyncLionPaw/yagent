/* ============ Harness：会话状态机 + agent loop ============
 * 内部维护 SPEC §8 的 Conversation 形状，所有状态变化通过 HarnessEvent 外发。
 * getConversation 返回的是活引用（UI 订阅事件后重新读取即可）。
 */

import type { Block, Conversation, ConversationNode, Role } from '../index.js'
import { toError } from '../providers/types.js'
import type { ChatMessage, ContentBlock, ModelProvider, ToolDef } from '../providers/types.js'

export type HarnessEvent =
  | { type: 'node_added'; convId: string; node: ConversationNode }
  | { type: 'node_updated'; convId: string; nodeId: string }
  | { type: 'conv_updated'; convId: string } // 创建 / 改名 / activeNode 切换
  | { type: 'conv_status_changed'; convId: string; status: Conversation['status'] }
  | { type: 'text_delta'; convId: string; nodeId: string; delta: string }
  | { type: 'thinking_delta'; convId: string; nodeId: string; delta: string }
  | { type: 'tool_status'; convId: string; nodeId: string; blockIndex: number; status: 'running' | 'done' | 'error' }
  | { type: 'error'; convId: string; nodeId?: string; error: Error }

export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<string>

export interface HarnessOptions {
  provider: ModelProvider
  model: string
  system?: string
  tools?: ToolDef[]
  executor?: ToolExecutor // 缺省时 tool_use 返回 "tool not available"
  maxTurns?: number // 默认 25
}

const TOOL_DETAIL_MAX = 4000
const TOOL_RESULT_MAX = 10_000

interface PendingToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  blockIndex: number
}

export class Harness {
  private provider: ModelProvider
  private model: string
  private system?: string
  private tools?: ToolDef[]
  private executor?: ToolExecutor
  private readonly maxTurns: number

  private readonly convs = new Map<string, Conversation>()
  private readonly listeners = new Set<(e: HarnessEvent) => void>()
  private readonly controllers = new Map<string, AbortController>()

  constructor(opts: HarnessOptions) {
    this.provider = opts.provider
    this.model = opts.model
    this.system = opts.system
    this.tools = opts.tools
    this.executor = opts.executor
    this.maxTurns = opts.maxTurns ?? 25
  }

  /* ---------- 订阅 ---------- */

  on(listener: (e: HarnessEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(e: HarnessEvent): void {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch {
        // listener 异常不影响 loop
      }
    }
  }

  /* ---------- 会话管理 ---------- */

  createConversation(title = '新会话', workdir: string | null = null): Conversation {
    const conv: Conversation = {
      id: uid('conv'),
      title,
      workdir,
      nodes: {},
      activeNodeId: '',
      status: 'done',
      refs: [],
      attachments: [],
      outputs: [],
    }
    this.convs.set(conv.id, conv)
    this.emit({ type: 'conv_updated', convId: conv.id })
    return conv
  }

  getConversation(id: string): Conversation | undefined {
    return this.convs.get(id)
  }

  listConversations(): Conversation[] {
    return [...this.convs.values()]
  }

  rename(convId: string, title: string): void {
    const conv = this.mustGet(convId)
    const t = title.trim()
    if (t) conv.title = t
    this.emit({ type: 'conv_updated', convId })
  }

  /** 切换当前节点（查看其他分支）；下一条 sendMessage 从该节点继续 */
  setActiveNode(convId: string, nodeId: string): void {
    const conv = this.mustGet(convId)
    if (!conv.nodes[nodeId]) throw new Error(`node not found: ${nodeId}`)
    conv.activeNodeId = nodeId
    this.emit({ type: 'conv_updated', convId })
  }

  /** 从某个节点分叉：等价于把 activeNode 移过去，下一条消息自然成为新分支 */
  forkFrom(convId: string, nodeId: string): void {
    this.setActiveNode(convId, nodeId)
  }

  /** 当前分支路径（根 → activeNode），ChatView 直接消费 */
  getActivePath(convId: string): ConversationNode[] {
    const conv = this.mustGet(convId)
    return pathTo(conv, conv.activeNodeId)
  }

  /* ---------- 核心入口 ---------- */

  async sendMessage(convId: string, text: string): Promise<void> {
    const conv = this.mustGet(convId)
    if (!text.trim()) throw new Error('message is empty')
    if (this.controllers.has(convId)) throw new Error('conversation is already running')

    const userNode = makeNode('user', conv.activeNodeId || null, [{ type: 'text', text }])
    this.addNode(conv, userNode)
    this.setStatus(conv, 'running')

    const controller = new AbortController()
    this.controllers.set(convId, controller)
    try {
      await this.runLoop(conv, controller.signal)
    } finally {
      this.controllers.delete(convId)
      // abort → waiting（暂停，等用户）；其余（done / error / maxTurns）→ done
      this.setStatus(conv, controller.signal.aborted ? 'waiting' : 'done')
    }
  }

  abort(convId: string): void {
    this.controllers.get(convId)?.abort()
  }

  /** 运行时切换模型 / provider（UI 换模型即调）；进行中的会话不受影响（下一条消息生效） */
  configure(opts: { provider?: ModelProvider; model?: string; system?: string }): void {
    if (opts.provider !== undefined) this.provider = opts.provider
    if (opts.model !== undefined) this.model = opts.model
    if (opts.system !== undefined) this.system = opts.system
  }

  /* ---------- agent loop ---------- */

  private async runLoop(conv: Conversation, signal: AbortSignal): Promise<void> {
    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (signal.aborted) return

      const messages = this.buildMessages(conv)
      const agentNode = makeNode('agent', conv.activeNodeId || null, [])
      this.addNode(conv, agentNode)
      const nodeStart = Date.now()
      const thinkingStarts = new Map<number, number>()
      const pending: PendingToolCall[] = []

      try {
        for await (const ev of this.provider.streamChat({
          model: this.model,
          system: this.system,
          messages,
          tools: this.tools,
          signal,
        })) {
          if (signal.aborted) break
          switch (ev.type) {
            case 'text_delta': {
              const last = agentNode.blocks[agentNode.blocks.length - 1]
              if (last?.type === 'text') last.text += ev.text
              else agentNode.blocks.push({ type: 'text', text: ev.text })
              this.emit({ type: 'text_delta', convId: conv.id, nodeId: agentNode.id, delta: ev.text })
              break
            }
            case 'thinking_delta': {
              const last = agentNode.blocks[agentNode.blocks.length - 1]
              if (last?.type === 'thinking' && last.status === 'streaming') {
                last.text += ev.text
              } else {
                agentNode.blocks.push({ type: 'thinking', text: ev.text, status: 'streaming' })
                thinkingStarts.set(agentNode.blocks.length - 1, Date.now())
              }
              this.emit({ type: 'thinking_delta', convId: conv.id, nodeId: agentNode.id, delta: ev.text })
              break
            }
            case 'tool_use': {
              agentNode.blocks.push({
                type: 'tool',
                tool: ev.name,
                summary: summarizeInput(ev.input),
                status: 'running',
                toolUseId: ev.id,
                input: ev.input,
              })
              pending.push({ id: ev.id, name: ev.name, input: ev.input, blockIndex: agentNode.blocks.length - 1 })
              this.emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })
              break
            }
            case 'done':
              break // usage 暂不持久化
            case 'error':
              throw ev.error
          }
        }
      } catch (err) {
        if (signal.aborted) return
        const error = toError(err)
        this.finishThinking(agentNode, thinkingStarts)
        agentNode.blocks.push({ type: 'text', text: `[error] ${error.message}` })
        agentNode.durationMs = Date.now() - nodeStart
        this.emit({ type: 'error', convId: conv.id, nodeId: agentNode.id, error })
        this.emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })
        return
      }

      this.finishThinking(agentNode, thinkingStarts)
      agentNode.durationMs = Date.now() - nodeStart
      this.emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })

      if (signal.aborted) return
      if (pending.length === 0) return // 纯文本回答，本轮结束

      // 执行工具调用
      const resultBlocks: Block[] = []
      for (const call of pending) {
        this.emit({
          type: 'tool_status',
          convId: conv.id,
          nodeId: agentNode.id,
          blockIndex: call.blockIndex,
          status: 'running',
        })
        const t0 = Date.now()
        const block = agentNode.blocks[call.blockIndex]
        try {
          const out = this.executor
            ? await this.executor(call.name, call.input, signal)
            : 'tool not available'
          if (block?.type === 'tool') {
            block.status = 'done'
            block.detail = truncate(out, TOOL_DETAIL_MAX)
            block.stats = `${((Date.now() - t0) / 1000).toFixed(1)}s`
          }
          resultBlocks.push({
            type: 'tool_result',
            tool: call.name,
            toolUseId: call.id,
            content: truncate(out, TOOL_RESULT_MAX),
          })
          this.emit({ type: 'tool_status', convId: conv.id, nodeId: agentNode.id, blockIndex: call.blockIndex, status: 'done' })
        } catch (err) {
          if (signal.aborted) {
            if (block?.type === 'tool') {
              block.status = 'error'
              block.detail = 'aborted'
            }
            this.emit({ type: 'tool_status', convId: conv.id, nodeId: agentNode.id, blockIndex: call.blockIndex, status: 'error' })
            this.emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })
            return
          }
          const msg = toError(err).message
          if (block?.type === 'tool') {
            block.status = 'error'
            block.detail = msg
          }
          resultBlocks.push({ type: 'tool_result', tool: call.name, toolUseId: call.id, content: msg, isError: true })
          this.emit({ type: 'tool_status', convId: conv.id, nodeId: agentNode.id, blockIndex: call.blockIndex, status: 'error' })
        }
        this.emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })
      }

      if (signal.aborted) return
      // 工具结果作为新的 user 节点，继续 loop
      const resultNode = makeNode('user', agentNode.id, resultBlocks)
      this.addNode(conv, resultNode)
    }
    this.emit({ type: 'error', convId: conv.id, error: new Error(`max turns reached (${this.maxTurns})`) })
  }

  private finishThinking(node: ConversationNode, starts: Map<number, number>): void {
    for (let i = 0; i < node.blocks.length; i++) {
      const b = node.blocks[i]
      if (b.type === 'thinking' && b.status === 'streaming') {
        b.status = 'done'
        const t0 = starts.get(i)
        if (t0) b.durationMs = Date.now() - t0
      }
    }
  }

  /* ---------- 树操作 / 消息拼装 ---------- */

  private addNode(conv: Conversation, node: ConversationNode): void {
    conv.nodes[node.id] = node
    conv.activeNodeId = node.id
    this.emit({ type: 'node_added', convId: conv.id, node })
  }

  private setStatus(conv: Conversation, status: Conversation['status']): void {
    if (conv.status === status) return
    conv.status = status
    this.emit({ type: 'conv_status_changed', convId: conv.id, status })
  }

  /** 根 → activeNode 路径拼成 messages；相邻同角色合并（provider 要求交替） */
  private buildMessages(conv: Conversation): ChatMessage[] {
    const out: ChatMessage[] = []
    for (const node of pathTo(conv, conv.activeNodeId)) {
      const msg = nodeToMessage(node)
      if (!msg) continue
      const last = out[out.length - 1]
      if (last && last.role === msg.role && Array.isArray(last.content) && Array.isArray(msg.content)) {
        last.content = [...last.content, ...msg.content]
      } else {
        out.push(msg)
      }
    }
    return out
  }

  private mustGet(convId: string): Conversation {
    const conv = this.convs.get(convId)
    if (!conv) throw new Error(`conversation not found: ${convId}`)
    return conv
  }
}

/* ---------- helpers ---------- */

function pathTo(conv: Conversation, nodeId: string): ConversationNode[] {
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

function nodeToMessage(node: ConversationNode): ChatMessage | null {
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

function summarizeInput(input: Record<string, unknown>): string {
  const cand = input.command ?? input.cmd ?? input.path ?? input.file_path ?? input.filePath ?? input.query ?? input.url
  const s = (typeof cand === 'string' ? cand : JSON.stringify(input)).replace(/\s+/g, ' ').trim()
  return s.length > 80 ? `${s.slice(0, 79)}…` : s
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… (truncated, ${s.length} chars total)` : s
}

let counter = 0
function uid(prefix: string): string {
  counter = (counter + 1) % 0xffff
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function makeNode(role: Role, parentId: string | null, blocks: Block[]): ConversationNode {
  return { id: uid(role === 'user' ? 'u' : 'a'), parentId, role, blocks, createdAt: Date.now() }
}

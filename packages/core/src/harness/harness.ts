/* ============ Harness：会话状态机 + agent loop ============
 * 内部维护 SPEC §8 的 Conversation 形状，所有状态变化通过 HarnessEvent 外发。
 * getConversation 返回的是活引用（UI 订阅事件后重新读取即可）。
 * agent loop 在 agent-loop.ts，树操作 / 消息拼装 / 工具执行 / 钩子各自成模块。
 */

import type {
  Block,
  Conversation,
  ConversationNode,
  UserFileAttach,
  UserImageAttach,
} from '../model.js'
import type { ModelProvider, ToolDef } from '../providers/types.js'
import { ContextManager } from './context.js'
import type { ContextSnapshot } from './context.js'
import { createConversationState, makeNode, pathTo } from './conversation.js'
import { runAgentLoop } from './agent-loop.js'
import { HookRunner } from './hooks.js'
import type { HarnessHooks } from './hooks.js'
import type { HarnessEvent } from './events.js'
import type { ToolExecutor } from './tools.js'
import { buildMessages } from './messages.js'

export interface HarnessOptions {
  provider: ModelProvider
  model: string
  system?: string
  tools?: ToolDef[]
  executor?: ToolExecutor // 缺省时 tool_use 返回 "tool not available"
  maxTurns?: number // 默认 25
  /** 模型上下文窗口（token）；缺省 128_000，可经 configure({ contextLimit }) 更新 */
  contextLimit?: number
  hooks?: HarnessHooks | HarnessHooks[] // 观测型生命周期钩子
}

export class Harness {
  private provider: ModelProvider
  private model: string
  private system?: string
  private tools?: ToolDef[]
  private executor?: ToolExecutor
  private readonly maxTurns: number
  private readonly context: ContextManager

  private readonly convs = new Map<string, Conversation>()
  private readonly listeners = new Set<(e: HarnessEvent) => void>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly hooks = new HookRunner()

  constructor(opts: HarnessOptions) {
    this.provider = opts.provider
    this.model = opts.model
    this.system = opts.system
    this.tools = opts.tools
    this.executor = opts.executor
    this.maxTurns = opts.maxTurns ?? 25
    this.context = new ContextManager({ limit: opts.contextLimit ?? 128_000 })
    if (opts.hooks) {
      for (const h of Array.isArray(opts.hooks) ? opts.hooks : [opts.hooks]) this.hooks.add(h)
    }
  }

  /* ---------- 订阅 ---------- */

  on(listener: (e: HarnessEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 运行时注册钩子，返回注销函数 */
  addHooks(hooks: HarnessHooks): () => void {
    return this.hooks.add(hooks)
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
    const conv = createConversationState(title, workdir)
    this.convs.set(conv.id, conv)
    this.emit({ type: 'conv_updated', convId: conv.id })
    this.hooks.runDetached('onConversationCreated', conv)
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

  /** 归档 / 取消归档：只改元数据，不删落盘 */
  setArchived(convId: string, archived: boolean): void {
    const conv = this.mustGet(convId)
    conv.archived = archived
    this.emit({ type: 'conv_updated', convId })
  }

  /** 追加用户附件元数据（文件本体由桌面端写入工作目录） */
  addAttachments(convId: string, files: { name: string; size: number }[]): void {
    const conv = this.mustGet(convId)
    if (!files.length) return
    conv.attachments.push(...files)
    this.emit({ type: 'conv_updated', convId })
  }

  /** 关联一条收获 id（正文在 dataDir/insights/）；新 id 插到列表头部 */
  addInsightId(convId: string, insightId: string): void {
    const conv = this.mustGet(convId)
    const id = insightId.trim()
    if (!id) return
    const list = conv.insightIds ?? []
    if (list.includes(id)) return
    conv.insightIds = [id, ...list]
    this.emit({ type: 'conv_updated', convId })
  }

  /** 从本会话解除收获关联（不删磁盘文件；由调用方决定是否 purge） */
  removeInsightId(convId: string, insightId: string): void {
    const conv = this.mustGet(convId)
    const list = conv.insightIds ?? []
    const next = list.filter((x) => x !== insightId)
    if (next.length === list.length) return
    conv.insightIds = next
    this.emit({ type: 'conv_updated', convId })
  }

  /** 更新会话的工作目录绑定 */
  setWorkdir(convId: string, workdir: string | null): void {
    const conv = this.mustGet(convId)
    conv.workdir = workdir?.trim() || null
    this.emit({ type: 'conv_updated', convId })
  }

  /** 切换当前节点（查看其他分支）；下一条 sendMessage 从该节点继续。空串 = 回到根（编辑首条消息时用） */
  setActiveNode(convId: string, nodeId: string): void {
    const conv = this.mustGet(convId)
    if (nodeId !== '' && !conv.nodes[nodeId]) throw new Error(`node not found: ${nodeId}`)
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

  /** 导入外部恢复的会话（持久化层 loadAll 用）；同 id 已存在则跳过 */
  importConversation(conv: Conversation): void {
    if (this.convs.has(conv.id)) return
    this.convs.set(conv.id, conv)
    this.emit({ type: 'conv_updated', convId: conv.id })
  }

  /** 删除会话：若在跑先中断 */
  deleteConversation(convId: string): void {
    if (!this.convs.has(convId)) return
    this.abort(convId)
    this.convs.delete(convId)
    this.context.clear(convId)
    this.emit({ type: 'conv_updated', convId })
  }

  /** 当前会话的上下文占用快照（估算拆分 + 最近 usage / 缓存占比） */
  getContextSnapshot(convId: string): ContextSnapshot {
    const conv = this.mustGet(convId)
    return this.context.snapshot(convId, buildMessages(conv), {
      system: this.system,
      tools: this.tools,
    })
  }

  /* ---------- 核心入口 ---------- */

  async sendMessage(
    convId: string,
    text: string,
    extras?: { images?: UserImageAttach[]; files?: UserFileAttach[] },
  ): Promise<void> {
    const conv = this.mustGet(convId)
    if (!text.trim() && !(extras?.images?.length) && !(extras?.files?.length)) {
      throw new Error('message is empty')
    }
    if (this.controllers.has(convId)) throw new Error('conversation is already running')

    const blocks: Block[] = [{ type: 'text', text: text || '请查看附件' }]
    for (const img of extras?.images ?? []) {
      blocks.push({
        type: 'image',
        mime: img.mime,
        name: img.name,
        path: img.path,
        data: img.data,
      })
    }
    for (const f of extras?.files ?? []) {
      blocks.push({
        type: 'file',
        name: f.name,
        size: f.size,
        path: f.path,
        mime: f.mime,
        preview: f.preview,
      })
    }
    const roundNode = makeNode('round', conv.activeNodeId || null, blocks)
    this.addNode(conv, roundNode)
    await this.hooks.run('onNodeAdded', conv, roundNode)
    this.setStatus(conv, 'running')

    const controller = new AbortController()
    this.controllers.set(convId, controller)
    try {
      const reason = await runAgentLoop(
        conv,
        roundNode,
        {
          resolveConfig: () => ({
            provider: this.provider,
            model: this.model,
            system: this.system,
            tools: this.tools,
          }),
          executor: this.executor,
          maxTurns: this.maxTurns,
          hooks: this.hooks,
          context: this.context,
          emit: (e) => this.emit(e),
        },
        controller.signal,
      )
      await this.hooks.run('onRunEnd', conv, reason)
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
  configure(opts: {
    provider?: ModelProvider
    model?: string
    system?: string
    tools?: ToolDef[]
    executor?: ToolExecutor
    contextLimit?: number
  }): void {
    if (opts.provider !== undefined) this.provider = opts.provider
    if (opts.model !== undefined) this.model = opts.model
    if (opts.system !== undefined) this.system = opts.system
    if (opts.tools !== undefined) this.tools = opts.tools
    if (opts.executor !== undefined) this.executor = opts.executor
    if (opts.contextLimit !== undefined) this.context.setLimit(opts.contextLimit)
  }

  /* ---------- 内部状态变更 ---------- */

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

  private mustGet(convId: string): Conversation {
    const conv = this.convs.get(convId)
    if (!conv) throw new Error(`conversation not found: ${convId}`)
    return conv
  }
}

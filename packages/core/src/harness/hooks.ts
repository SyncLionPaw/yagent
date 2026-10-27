/* ============ 生命周期钩子：观测型（observational only） ============
 * handler 抛错一律吞掉，绝不影响 agent loop；权限/veto 型拦截不在此范畴。
 */

import type { Conversation, ConversationNode } from '../model.js'
import type { ToolCallInfo } from './tools.js'

export type RunEndReason = 'done' | 'aborted' | 'error' | 'max_turns'

export interface ToolCallResult {
  output: string
  durationMs: number
  isError: boolean
}

export interface HarnessHooks {
  onConversationCreated?(conv: Conversation): void | Promise<void>
  onNodeAdded?(conv: Conversation, node: ConversationNode): void | Promise<void>
  onTurnStart?(conv: Conversation, node: ConversationNode): void | Promise<void>
  onToolStart?(conv: Conversation, node: ConversationNode, call: ToolCallInfo): void | Promise<void>
  onToolEnd?(
    conv: Conversation,
    node: ConversationNode,
    call: ToolCallInfo,
    result: ToolCallResult,
  ): void | Promise<void>
  onError?(conv: Conversation, error: Error, nodeId?: string): void | Promise<void>
  onRunEnd?(conv: Conversation, reason: RunEndReason): void | Promise<void>
}

/* 各钩子的参数签名，供 HookRunner.run 做类型推导 */
interface HookArgs {
  onConversationCreated: [conv: Conversation]
  onNodeAdded: [conv: Conversation, node: ConversationNode]
  onTurnStart: [conv: Conversation, node: ConversationNode]
  onToolStart: [conv: Conversation, node: ConversationNode, call: ToolCallInfo]
  onToolEnd: [conv: Conversation, node: ConversationNode, call: ToolCallInfo, result: ToolCallResult]
  onError: [conv: Conversation, error: Error, nodeId?: string]
  onRunEnd: [conv: Conversation, reason: RunEndReason]
}

export class HookRunner {
  private readonly hooks: HarnessHooks[] = []

  /** 注册一组钩子，返回注销函数 */
  add(hooks: HarnessHooks): () => void {
    this.hooks.push(hooks)
    return () => {
      const i = this.hooks.indexOf(hooks)
      if (i >= 0) this.hooks.splice(i, 1)
    }
  }

  /** 顺序 await 每个 handler；单个抛错吞掉（与 emit 对 listener 的容错策略一致） */
  async run<K extends keyof HarnessHooks>(name: K, ...args: HookArgs[K]): Promise<void> {
    for (const h of this.hooks) {
      const fn = h[name]
      if (!fn) continue
      try {
        await (fn as (...a: unknown[]) => unknown)(...args)
      } catch {
        // 钩子异常不影响 loop
      }
    }
  }

  /** fire-and-forget，仅用于同步调用点（如 createConversation） */
  runDetached<K extends keyof HarnessHooks>(name: K, ...args: HookArgs[K]): void {
    void this.run(name, ...args).catch(() => {})
  }
}

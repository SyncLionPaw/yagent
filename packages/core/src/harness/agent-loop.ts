/* ============ agent loop：流式消费 + 工具调用循环 ============
 * 一轮问答 = 一个 round 节点：loop 期间所有产出（思考/文本/工具调用/工具结果）
 * 都追加进同一个节点，不再每轮/每个工具结果新建节点。
 * resolveConfig() 每轮循环开头调用一次：configure() 换模型下一轮生效。
 */

import type { Conversation, ConversationNode } from '../model.js'
import { syncConversationRefs } from '../refs.js'
import { toError } from '../providers/types.js'
import type { ModelProvider, ToolDef } from '../providers/types.js'
import type { ContextManager } from './context.js'
import { buildMessages } from './messages.js'
import type { HarnessEvent } from './events.js'
import type { HookRunner, RunEndReason } from './hooks.js'
import { artifactKindOf, executeToolCall, summarizeInput } from './tools.js'
import type { ToolCallInfo, ToolExecutor } from './tools.js'

export interface LoopContext {
  resolveConfig(): { provider: ModelProvider; model: string; system?: string; tools?: ToolDef[] }
  executor?: ToolExecutor
  maxTurns: number
  hooks: HookRunner
  context: ContextManager
  emit(e: HarnessEvent): void
}

export async function runAgentLoop(
  conv: Conversation,
  roundNode: ConversationNode,
  ctx: LoopContext,
  signal: AbortSignal,
): Promise<RunEndReason> {
  const { hooks, emit } = ctx
  const nodeStart = Date.now()
  const nodeUpdated = (): void => {
    roundNode.durationMs = Date.now() - nodeStart
    syncConversationRefs(conv)
    emit({ type: 'node_updated', convId: conv.id, nodeId: roundNode.id })
  }

  for (let turn = 0; turn < ctx.maxTurns; turn++) {
    if (signal.aborted) return 'aborted'

    // 每轮循环开头重读配置：configure() 换模型下一轮生效
    const { provider, model, system, tools } = ctx.resolveConfig()
    const prepared = ctx.context.prepare(conv.id, buildMessages(conv), { system, tools })
    emit({ type: 'context_updated', convId: conv.id, snapshot: prepared.snapshot })
    await hooks.run('onTurnStart', conv, roundNode)
    const thinkingStarts = new Map<number, number>()
    const pending: ToolCallInfo[] = []

    try {
      for await (const ev of provider.streamChat({
        model,
        system,
        messages: prepared.messages,
        tools,
        signal,
      })) {
        if (signal.aborted) break
        switch (ev.type) {
          case 'text_delta': {
            // blocks[0] 是用户输入，绝不能把模型输出拼进去；只追加到其后的 text 块
            const last = roundNode.blocks[roundNode.blocks.length - 1]
            const canAppend = last?.type === 'text' && roundNode.blocks.length > 1
            if (canAppend) last.text += ev.text
            else roundNode.blocks.push({ type: 'text', text: ev.text })
            syncConversationRefs(conv)
            emit({ type: 'text_delta', convId: conv.id, nodeId: roundNode.id, delta: ev.text })
            break
          }
          case 'thinking_delta': {
            const last = roundNode.blocks[roundNode.blocks.length - 1]
            if (last?.type === 'thinking' && last.status === 'streaming') {
              last.text += ev.text
            } else {
              roundNode.blocks.push({ type: 'thinking', text: ev.text, status: 'streaming' })
              thinkingStarts.set(roundNode.blocks.length - 1, Date.now())
            }
            emit({ type: 'thinking_delta', convId: conv.id, nodeId: roundNode.id, delta: ev.text })
            break
          }
          case 'tool_use': {
            roundNode.blocks.push({
              type: 'tool',
              tool: ev.name,
              summary: summarizeInput(ev.input),
              status: 'running',
              toolUseId: ev.id,
              input: ev.input,
            })
            pending.push({ id: ev.id, name: ev.name, input: ev.input, blockIndex: roundNode.blocks.length - 1 })
            nodeUpdated()
            break
          }
          case 'done': {
            if (ev.usage) {
              const snap = ctx.context.recordUsage(conv.id, ev.usage)
              emit({ type: 'context_updated', convId: conv.id, snapshot: snap })
            }
            break
          }
          case 'error':
            throw ev.error
        }
      }
    } catch (err) {
      if (signal.aborted) return 'aborted'
      const error = toError(err)
      finishThinking(roundNode, thinkingStarts)
      roundNode.blocks.push({ type: 'text', text: `[error] ${error.message}` })
      emit({ type: 'error', convId: conv.id, nodeId: roundNode.id, error })
      nodeUpdated()
      await hooks.run('onError', conv, error, roundNode.id)
      return 'error'
    }

    finishThinking(roundNode, thinkingStarts)
    nodeUpdated()

    if (signal.aborted) return 'aborted'
    if (pending.length === 0) return 'done' // 纯文本回答，本轮结束

    // 执行工具调用：结果直接追加进本 round 节点
    // 产物仅纯 chat（无 workdir）：code/工作区模式文件就在项目树里，不另搞 outputs
    const trackArtifacts = !conv.workdir?.trim()
    const writtenBatch: { name: string; size: number }[] = []
    for (const call of pending) {
      const { resultBlock, aborted, written } = await executeToolCall(
        conv,
        call,
        roundNode,
        ctx.executor,
        hooks,
        emit,
        signal,
      )
      if (aborted) return 'aborted'
      if (resultBlock) {
        roundNode.blocks.push(resultBlock)
        nodeUpdated()
      }
      if (trackArtifacts && written) writtenBatch.push(written)
    }
    if (writtenBatch.length) {
      const now = Date.now()
      for (const f of writtenBatch) {
        const i = conv.outputs.findIndex((o) => o.name === f.name)
        if (i >= 0) conv.outputs[i] = f
        else conv.outputs.push(f)
      }
      roundNode.blocks.push({
        type: 'artifacts',
        items: writtenBatch.map((f, idx) => ({
          id: `${roundNode.id}-w${turn}-${idx}-${f.name}`,
          name: f.name,
          kind: artifactKindOf(f.name),
          size: f.size,
          createdAt: now,
        })),
      })
      emit({ type: 'conv_updated', convId: conv.id })
      nodeUpdated()
    }
  }
  // 触顶时必须在对话里留可见说明，避免看起来像「突然不说话了」
  const maxTurnsError = new Error(`max turns reached (${ctx.maxTurns})`)
  roundNode.blocks.push({
    type: 'text',
    text:
      `本轮已达到工具循环上限（${ctx.maxTurns} 轮），先停在这里。` +
      `已完成的步骤都还在；直接再发一条消息（例如「继续」）即可接着干。`,
  })
  emit({ type: 'error', convId: conv.id, nodeId: roundNode.id, error: maxTurnsError })
  nodeUpdated()
  await hooks.run('onError', conv, maxTurnsError, roundNode.id)
  return 'max_turns'
}

function finishThinking(node: ConversationNode, starts: Map<number, number>): void {
  for (let i = 0; i < node.blocks.length; i++) {
    const b = node.blocks[i]
    if (b.type === 'thinking' && b.status === 'streaming') {
      b.status = 'done'
      const t0 = starts.get(i)
      if (t0) b.durationMs = Date.now() - t0
    }
  }
}

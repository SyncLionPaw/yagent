/* ============ MockProvider：无 key 开发用 ============
 * 把固定示例回答按 30ms/字切片流出。
 * 首轮：thinking → text → tool_use；收到 tool_result 后：thinking → 收尾 text。
 */

import type { ChatRequest, ModelProvider, StreamEvent } from './types.js'

export interface MockProviderOptions {
  charDelayMs?: number // 默认 30
  toolName?: string // 默认取 req.tools[0]?.name ?? 'bash'
}

const THINKING = '用户想看看当前项目的情况。我先确认一下目录结构，再决定下一步。这一步不需要问用户，直接查。'
const PRE_TEXT = '我先看一下当前目录的结构。'
const FINAL_THINKING = '工具结果已经拿到了，可以收尾：总结看到的内容，并说明这是模拟数据。'
const FINAL_TEXT =
  '看完了。这是 MockProvider 的固定收尾回复——接入真实模型后，这里会基于工具返回给出实际结论。需要我继续做什么，直接说。'

let callSeq = 0

export class MockProvider implements ModelProvider {
  readonly id = 'mock'
  private readonly opts: MockProviderOptions

  constructor(options: MockProviderOptions = {}) {
    this.opts = options
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const delay = this.opts.charDelayMs ?? 30
    const hasToolResult = req.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
    )
    const script: StreamEvent[] = []
    if (hasToolResult) {
      script.push(
        ...chars(FINAL_THINKING, 'thinking_delta'),
        ...chars(FINAL_TEXT, 'text_delta'),
        { type: 'done', usage: { input: 128, output: 42 } },
      )
    } else {
      const toolName = this.opts.toolName ?? req.tools?.[0]?.name ?? 'bash'
      const input =
        toolName === 'bash' || toolName === 'Bash' ? { command: 'ls' } : ({} as Record<string, unknown>)
      script.push(
        ...chars(THINKING, 'thinking_delta'),
        ...chars(PRE_TEXT, 'text_delta'),
        { type: 'tool_use', id: `mock_call_${++callSeq}`, name: toolName, input },
        { type: 'done', usage: { input: 96, output: 33 } },
      )
    }
    for (const ev of script) {
      if (req.signal?.aborted) return
      yield ev
      if (ev.type === 'text_delta' || ev.type === 'thinking_delta') await sleep(delay, req.signal)
    }
  }
}

function chars(text: string, type: 'text_delta' | 'thinking_delta'): StreamEvent[] {
  return [...text].map((ch) => ({ type, text: ch }))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      clearTimeout(t)
      cleanup()
      resolve()
    }
    const t = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

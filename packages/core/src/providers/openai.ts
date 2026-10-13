/* ============ OpenAI 兼容协议（chat/completions，SSE 流式） ============
 * 支持自定义 baseURL（国产模型 / 代理端点），
 * delta.reasoning_content（DeepSeek 等）映射为 thinking_delta。
 */

import { parseSSE, postSSE } from './sse.js'
import { toError } from './types.js'
import type { ChatRequest, ModelProvider, StreamEvent } from './types.js'

export interface OpenAIProviderOptions {
  apiKey: string
  baseURL?: string // 默认 https://api.openai.com/v1
  extraHeaders?: Record<string, string>
  includeUsage?: boolean // 默认 true：请求 stream_options.include_usage
}

interface WireChunk {
  choices?: {
    index?: number
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: {
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }[]
    }
    finish_reason?: string | null
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

interface ToolCallState {
  id: string
  name: string
  args: string
}

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai'
  private readonly opts: OpenAIProviderOptions

  constructor(options: OpenAIProviderOptions) {
    this.opts = options
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const o = this.opts
    const baseURL = (o.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      messages: toWireMessages(req),
    }
    if (o.includeUsage !== false) body.stream_options = { include_usage: true }
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }

    try {
      const res = await postSSE(`${baseURL}/chat/completions`, {
        headers: { authorization: `Bearer ${o.apiKey}`, ...o.extraHeaders },
        body,
        signal: req.signal,
      })
      yield* this.parse(res, req.signal)
    } catch (err) {
      if (req.signal?.aborted) return
      yield { type: 'error', error: toError(err) }
    }
  }

  private async *parse(res: Response, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const calls = new Map<number, ToolCallState>()
    let usage: { input: number; output: number } | undefined

    const drainToolCalls = (): StreamEvent[] => {
      const out: StreamEvent[] = []
      for (const idx of [...calls.keys()].sort((a, b) => a - b)) {
        const st = calls.get(idx)
        if (!st) continue
        let input: Record<string, unknown> = {}
        if (st.args) {
          try {
            input = JSON.parse(st.args) as Record<string, unknown>
          } catch {
            // 截断的 JSON 按空调用处理
          }
        }
        out.push({ type: 'tool_use', id: st.id || `call_${idx}`, name: st.name || 'unknown', input })
      }
      calls.clear()
      return out
    }

    for await (const sse of parseSSE(res, signal)) {
      if (signal?.aborted) return
      if (sse.data.trim() === '[DONE]') break
      let chunk: WireChunk
      try {
        chunk = JSON.parse(sse.data) as WireChunk
      } catch {
        continue
      }
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
        yield { type: 'thinking_delta', text: delta.reasoning_content }
      }
      if (typeof delta?.content === 'string' && delta.content) {
        yield { type: 'text_delta', text: delta.content }
      }
      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const st = calls.get(idx) ?? { id: '', name: '', args: '' }
        if (tc.id) st.id = tc.id
        if (tc.function?.name) st.name += tc.function.name
        if (tc.function?.arguments) st.args += tc.function.arguments
        calls.set(idx, st)
      }
      if (choice?.finish_reason === 'tool_calls') {
        for (const ev of drainToolCalls()) yield ev
      }
      if (chunk.usage) {
        usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 }
      }
    }
    if (signal?.aborted) return
    // 兜底：部分端点流结束时没有 finish_reason
    for (const ev of drainToolCalls()) yield ev
    yield { type: 'done', ...(usage ? { usage } : {}) }
  }
}

function toWireMessages(req: ChatRequest): unknown[] {
  const out: unknown[] = []
  if (req.system) out.push({ role: 'system', content: req.system })
  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      if (msg.content) out.push({ role: msg.role, content: msg.content })
      continue
    }
    if (msg.role === 'assistant') {
      const texts: string[] = []
      const toolCalls: unknown[] = []
      for (const b of msg.content) {
        if (b.type === 'text') texts.push(b.text)
        else if (b.type === 'tool_use') {
          toolCalls.push({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          })
        }
        // thinking 不回放
      }
      out.push({
        role: 'assistant',
        content: texts.join('\n') || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
    } else {
      // tool_result 必须展开成紧跟 assistant 的独立 role:'tool' 消息，先于本节点的文本
      const texts: string[] = []
      for (const b of msg.content) {
        if (b.type === 'text') texts.push(b.text)
        else if (b.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content })
        }
      }
      if (texts.length) out.push({ role: 'user', content: texts.join('\n') })
    }
  }
  return out
}

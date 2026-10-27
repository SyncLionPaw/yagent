/* ============ Anthropic Messages API（SSE 流式） ============ */

import { parseSSE, postSSE } from './sse.js'
import { toError } from './types.js'
import type { ChatRequest, ModelProvider, StreamEvent } from './types.js'

export interface AnthropicProviderOptions {
  apiKey: string
  baseURL?: string // 默认 https://api.anthropic.com
  maxTokens?: number // 默认 8192
  thinkingBudget?: number // 设置后开启 extended thinking（budget_tokens）
  extraHeaders?: Record<string, string>
}

const API_VERSION = '2023-06-01'

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/* Anthropic 流事件里我们关心的字段（其余忽略） */
interface WireEvent {
  type?: string
  index?: number
  message?: { usage?: AnthropicUsage }
  content_block?: { type?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
  usage?: AnthropicUsage
  error?: { message?: string }
}

type UsageState = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

function mergeAnthropicUsage(prev: UsageState | undefined, u: AnthropicUsage): UsageState {
  const next: UsageState = {
    input: u.input_tokens ?? prev?.input ?? 0,
    output: u.output_tokens ?? prev?.output ?? 0,
  }
  const cacheRead = u.cache_read_input_tokens ?? prev?.cacheRead
  const cacheWrite = u.cache_creation_input_tokens ?? prev?.cacheWrite
  if (cacheRead != null) next.cacheRead = cacheRead
  if (cacheWrite != null) next.cacheWrite = cacheWrite
  return next
}

interface BlockState {
  kind: 'text' | 'thinking' | 'tool_use' | 'other'
  id?: string
  name?: string
  json: string
}

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic'
  private readonly opts: AnthropicProviderOptions

  constructor(options: AnthropicProviderOptions) {
    this.opts = options
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const o = this.opts
    const baseURL = (o.baseURL ?? 'https://api.anthropic.com').replace(/\/+$/, '')
    const maxTokens = o.maxTokens ?? 8192
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: o.thinkingBudget ? Math.max(maxTokens, o.thinkingBudget + 4096) : maxTokens,
      stream: true,
      messages: toWireMessages(req),
    }
    if (req.system) body.system = req.system
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    }
    if (o.thinkingBudget) body.thinking = { type: 'enabled', budget_tokens: o.thinkingBudget }

    try {
      const res = await postSSE(`${baseURL}/v1/messages`, {
        headers: {
          'x-api-key': o.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
          ...o.extraHeaders,
        },
        body,
        signal: req.signal,
      })
      yield* this.parse(res, req.signal)
    } catch (err) {
      if (req.signal?.aborted) return // 中断：干净结束
      yield { type: 'error', error: toError(err) }
    }
  }

  private async *parse(res: Response, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const blocks = new Map<number, BlockState>()
    let usage: UsageState | undefined
    for await (const sse of parseSSE(res, signal)) {
      if (signal?.aborted) return
      let data: WireEvent
      try {
        data = JSON.parse(sse.data) as WireEvent
      } catch {
        continue
      }
      switch (data.type) {
        case 'message_start': {
          const u = data.message?.usage
          if (u) usage = mergeAnthropicUsage(usage, u)
          break
        }
        case 'content_block_start': {
          const idx = data.index ?? 0
          const cb = data.content_block
          if (cb?.type === 'tool_use') {
            const st: BlockState = { kind: 'tool_use', json: '' }
            if (cb.id !== undefined) st.id = cb.id
            if (cb.name !== undefined) st.name = cb.name
            blocks.set(idx, st)
          } else if (cb?.type === 'thinking') {
            blocks.set(idx, { kind: 'thinking', json: '' })
          } else {
            blocks.set(idx, { kind: cb?.type === 'text' ? 'text' : 'other', json: '' })
          }
          break
        }
        case 'content_block_delta': {
          const st = blocks.get(data.index ?? 0)
          const d = data.delta
          if (!st || !d) break
          if (d.type === 'text_delta' && typeof d.text === 'string') {
            yield { type: 'text_delta', text: d.text }
          } else if (d.type === 'thinking_delta' && typeof d.thinking === 'string') {
            yield { type: 'thinking_delta', text: d.thinking }
          } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
            st.json += d.partial_json // 累积，content_block_stop 时一次性 parse
          }
          // signature_delta 等忽略：回放历史时 thinking 块整体省略（见 toWireMessages）
          break
        }
        case 'content_block_stop': {
          const idx = data.index ?? 0
          const st = blocks.get(idx)
          if (st?.kind === 'tool_use') {
            let input: Record<string, unknown> = {}
            if (st.json) {
              try {
                input = JSON.parse(st.json) as Record<string, unknown>
              } catch {
                // 截断的 JSON 按空调用处理
              }
            }
            yield { type: 'tool_use', id: st.id ?? `toolu_${idx}`, name: st.name ?? 'unknown', input }
          }
          blocks.delete(idx)
          break
        }
        case 'message_delta': {
          const u = data.usage
          if (u) usage = mergeAnthropicUsage(usage, u)
          break
        }
        case 'message_stop':
          yield { type: 'done', ...(usage ? { usage } : {}) }
          return
        case 'error':
          yield { type: 'error', error: new Error(data.error?.message ?? 'anthropic stream error') }
          return
        default:
          break // ping 等
      }
    }
    if (!signal?.aborted) yield { type: 'done', ...(usage ? { usage } : {}) }
  }
}

function toWireMessages(req: ChatRequest): unknown[] {
  const out: unknown[] = []
  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      if (msg.content) out.push({ role: msg.role, content: msg.content })
      continue
    }
    const blocks: unknown[] = []
    for (const b of msg.content) {
      switch (b.type) {
        case 'text':
          if (b.text) blocks.push({ type: 'text', text: b.text })
          break
        case 'image':
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: b.mime, data: b.data },
          })
          break
        case 'thinking':
          break // 不回放：无 signature 会被 API 拒绝，多轮里服务端本就会剥离
        case 'tool_use':
          blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
          break
        case 'tool_result':
          blocks.push({
            type: 'tool_result',
            tool_use_id: b.toolUseId,
            content: b.content,
            is_error: b.isError,
          })
          break
      }
    }
    if (blocks.length) out.push({ role: msg.role, content: blocks })
  }
  return out
}

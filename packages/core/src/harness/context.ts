/* ============ ContextManager：上下文预算与用量 ============
 * 职责：估算 prompt 占用（拆分 system / tools / messages）、超限裁剪、记录 API usage（含缓存）。
 * 不改持久化会话树——只影响发往模型的临时 messages。
 */

import type { ChatMessage, ContentBlock, ToolDef } from '../providers/types.js'

/** 单次 API 回报的 token 用量 */
export interface TokenUsage {
  input: number
  output: number
  /** prompt cache 读命中 */
  cacheRead?: number
  /** prompt cache 写入 */
  cacheWrite?: number
}

export interface ContextTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** 估算占用拆分（均约 token） */
export interface ContextBreakdown {
  system: number
  tools: number
  messages: number
  /** messages 内工具结果块 */
  toolResults: number
}

/** UI / 观测用快照 */
export interface ContextSnapshot {
  /** 估算的当前 prompt tokens = system + tools + messages */
  estimated: number
  /** 模型上下文窗口 */
  limit: number
  /** estimated / limit */
  ratio: number
  /** soft 阈值（超过开始裁剪），默认 0.85 */
  softRatio: number
  breakdown: ContextBreakdown
  /** 最近一次 API 回报 */
  lastUsage?: TokenUsage
  /** 本会话累计 */
  totals: ContextTotals
  /** 最近一次 prepare 是否裁剪过 */
  trimmed: boolean
  /** 裁剪掉的估算 tokens（仅本轮 prepare） */
  trimmedTokens: number
  /** 缓存读占比：cacheRead / input（有 lastUsage 时） */
  cacheHitRatio: number | null
}

export interface ContextEstimateInput {
  system?: string
  tools?: ToolDef[]
}

export interface ContextManagerOptions {
  /** 上下文窗口上限（token） */
  limit: number
  /** 超过 limit * softRatio 开始裁剪，默认 0.85 */
  softRatio?: number
  /** 单条 tool_result 在超限裁剪时的目标上限（字符），默认 8000 */
  toolResultCharCap?: number
}

export interface PrepareResult {
  messages: ChatMessage[]
  snapshot: ContextSnapshot
}

const DEFAULT_SOFT = 0.85
const DEFAULT_TOOL_CAP = 8000
/** 图片按固定开销估算（粗略；真实取决于厂商） */
const IMAGE_TOKENS = 800
const NOTICE =
  '[context trimmed: earlier turns omitted to fit the model context window]'

interface ConvState {
  lastUsage?: TokenUsage
  totals: ContextTotals
  lastTrimmed: boolean
  lastTrimmedTokens: number
  lastBreakdown: ContextBreakdown
}

function emptyTotals(): ContextTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function emptyBreakdown(): ContextBreakdown {
  return { system: 0, tools: 0, messages: 0, toolResults: 0 }
}

export function estimateBreakdown(
  messages: ChatMessage[],
  input: ContextEstimateInput = {},
): ContextBreakdown {
  const system = input.system ? charsToTokens(input.system) : 0
  const tools = estimateTools(input.tools)
  let messagesTok = 0
  let toolResults = 0
  for (const msg of messages) {
    messagesTok += estimateMessage(msg)
    toolResults += estimateToolResultsIn(msg)
  }
  return { system, tools, messages: messagesTok, toolResults }
}

/** 粗估总量：system + tools + messages */
export function estimateTokens(
  messages: ChatMessage[],
  system?: string,
  tools?: ToolDef[],
): number {
  const b = estimateBreakdown(messages, { system, tools })
  return b.system + b.tools + b.messages
}

function estimateTools(tools?: ToolDef[]): number {
  if (!tools?.length) return 0
  let n = 0
  for (const t of tools) {
    n += charsToTokens(t.name) + charsToTokens(t.description) + charsToTokens(JSON.stringify(t.parameters))
    n += 8 // 结构开销
  }
  return n
}

function estimateMessage(msg: ChatMessage): number {
  let n = 4
  if (typeof msg.content === 'string') return n + charsToTokens(msg.content)
  for (const b of msg.content) n += estimateBlock(b)
  return n
}

function estimateToolResultsIn(msg: ChatMessage): number {
  if (typeof msg.content === 'string') return 0
  let n = 0
  for (const b of msg.content) {
    if (b.type === 'tool_result') n += estimateBlock(b)
  }
  return n
}

function estimateBlock(b: ContentBlock): number {
  switch (b.type) {
    case 'text':
      return charsToTokens(b.text)
    case 'thinking':
      return charsToTokens(b.text)
    case 'image':
      return IMAGE_TOKENS
    case 'tool_use':
      return charsToTokens(b.name) + charsToTokens(JSON.stringify(b.input))
    case 'tool_result':
      return charsToTokens(b.content) + 8
  }
}

function charsToTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    typeof m.content === 'string'
      ? { role: m.role, content: m.content }
      : { role: m.role, content: m.content.map((b) => ({ ...b })) },
  )
}

/**
 * 上下文管理器：按会话维护用量；prepare() 产出可安全发送的 messages。
 */
export class ContextManager {
  private limit: number
  private softRatio: number
  private toolResultCharCap: number
  private readonly byConv = new Map<string, ConvState>()

  constructor(opts: ContextManagerOptions) {
    this.limit = Math.max(1, opts.limit)
    this.softRatio = opts.softRatio ?? DEFAULT_SOFT
    this.toolResultCharCap = opts.toolResultCharCap ?? DEFAULT_TOOL_CAP
  }

  setLimit(limit: number): void {
    this.limit = Math.max(1, limit)
  }

  getLimit(): number {
    return this.limit
  }

  /** 记录一轮 stream 的 usage；累加 totals */
  recordUsage(convId: string, usage: TokenUsage): ContextSnapshot {
    const st = this.state(convId)
    st.lastUsage = usage
    st.totals.input += usage.input
    st.totals.output += usage.output
    st.totals.cacheRead += usage.cacheRead ?? 0
    st.totals.cacheWrite += usage.cacheWrite ?? 0
    return this.buildSnapshot(st, st.lastBreakdown)
  }

  clear(convId: string): void {
    this.byConv.delete(convId)
  }

  snapshot(
    convId: string,
    messages?: ChatMessage[],
    input: ContextEstimateInput = {},
  ): ContextSnapshot {
    const st = this.state(convId)
    if (messages) {
      const breakdown = estimateBreakdown(messages, input)
      st.lastBreakdown = breakdown
      return this.buildSnapshot(st, breakdown)
    }
    return this.buildSnapshot(st, st.lastBreakdown)
  }

  /**
   * 超 soft 阈值时：先压缩过长 tool_result，再从最早可丢的完整消息对裁掉，
   * 并保证 tool_use / tool_result 配对不被拆开。
   */
  prepare(
    convId: string,
    messages: ChatMessage[],
    input: ContextEstimateInput = {},
  ): PrepareResult {
    const budget = Math.floor(this.limit * this.softRatio)
    const rawEstimate = estimateTokens(messages, input.system, input.tools)
    let out = cloneMessages(messages)
    let trimmed = false

    if (rawEstimate > budget) {
      if (shrinkToolResults(out, this.toolResultCharCap)) trimmed = true
    }
    if (estimateTokens(out, input.system, input.tools) > budget) {
      if (dropOldestTurns(out, budget, input) > 0) {
        trimmed = true
        out = ensureTrimNotice(out)
      }
    }

    const breakdown = estimateBreakdown(out, input)
    const estimated = breakdown.system + breakdown.tools + breakdown.messages
    const st = this.state(convId)
    st.lastTrimmed = trimmed
    st.lastTrimmedTokens = Math.max(0, rawEstimate - estimated)
    st.lastBreakdown = breakdown
    return { messages: out, snapshot: this.buildSnapshot(st, breakdown) }
  }

  private state(convId: string): ConvState {
    let st = this.byConv.get(convId)
    if (!st) {
      st = {
        totals: emptyTotals(),
        lastTrimmed: false,
        lastTrimmedTokens: 0,
        lastBreakdown: emptyBreakdown(),
      }
      this.byConv.set(convId, st)
    }
    return st
  }

  private buildSnapshot(st: ConvState, breakdown: ContextBreakdown): ContextSnapshot {
    const estimated = breakdown.system + breakdown.tools + breakdown.messages
    const last = st.lastUsage
    const cacheHitRatio =
      last && last.input > 0 && last.cacheRead != null
        ? Math.min(1, last.cacheRead / last.input)
        : null
    return {
      estimated,
      limit: this.limit,
      ratio: estimated / this.limit,
      softRatio: this.softRatio,
      breakdown: { ...breakdown },
      ...(last ? { lastUsage: last } : {}),
      totals: { ...st.totals },
      trimmed: st.lastTrimmed,
      trimmedTokens: st.lastTrimmedTokens,
      cacheHitRatio,
    }
  }
}

/** 就地压缩过长 tool_result；有改动返回 true */
function shrinkToolResults(messages: ChatMessage[], cap: number): boolean {
  let changed = false
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue
    for (let i = 0; i < msg.content.length; i++) {
      const b = msg.content[i]
      if (b.type !== 'tool_result' || b.content.length <= cap) continue
      msg.content[i] = {
        ...b,
        content: `${b.content.slice(0, cap)}\n… (truncated for context, ${b.content.length} chars total)`,
      }
      changed = true
    }
  }
  return changed
}

function dropOldestTurns(
  messages: ChatMessage[],
  budget: number,
  input: ContextEstimateInput,
): number {
  if (messages.length <= 1) return 0
  let dropped = 0
  while (estimateTokens(messages, input.system, input.tools) > budget && messages.length > 1) {
    const end = turnEndIndex(messages, 0)
    if (end >= messages.length - 1) break
    messages.splice(0, end + 1)
    dropped += end + 1
  }
  return dropped
}

function turnEndIndex(messages: ChatMessage[], start: number): number {
  const msg = messages[start]
  if (!msg) return start
  if (msg.role === 'assistant' && hasToolUse(msg)) {
    const next = messages[start + 1]
    if (next && next.role === 'user' && hasToolResult(next)) return start + 1
  }
  return start
}

function hasToolUse(msg: ChatMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_use')
}

function hasToolResult(msg: ChatMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_result')
}

function ensureTrimNotice(messages: ChatMessage[]): ChatMessage[] {
  const first = messages[0]
  if (first?.role === 'user' && typeof first.content === 'string' && first.content.startsWith(NOTICE)) {
    return messages
  }
  if (first?.role === 'user' && Array.isArray(first.content)) {
    const already = first.content.some((b) => b.type === 'text' && b.text.startsWith(NOTICE))
    if (already) return messages
    return [
      { role: 'user', content: [{ type: 'text', text: NOTICE }, ...first.content] },
      ...messages.slice(1),
    ]
  }
  return [{ role: 'user', content: NOTICE }, ...messages]
}

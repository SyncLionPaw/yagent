/* ============ 工具执行：ToolExecutor + 单个工具调用的执行块 ============ */

import type { ToolDef } from '../providers/types.js'
import type { Block, Conversation, ConversationNode } from '../model.js'
import { toError } from '../providers/types.js'
import type { HarnessEvent } from './events.js'
import type { HookRunner } from './hooks.js'
import { LOAD_SKILL_TOOL } from './skills.js'

export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  conv: Conversation,
) => Promise<string>

export const DEFAULT_TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file by pages. path: relative to the bound working directory, or an absolute path under app uploads (…/projects/<slug>/uploads/<convId>/ or …/chats/uploads/<convId>/)—never invent .yagent/uploads/. Optional offset (1-based line, default 1) and limit (max lines, default 2000). Large files return a PARTIAL page with the next offset; call again to continue. Prefer Grep/search for needles instead of reading everything.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', description: '1-based start line (default 1)' },
        limit: { type: 'integer', description: 'Max lines to return (default 2000)' },
      },
      required: ['path'],
    },
  },
  { name: 'write_file', description: 'Write a UTF-8 file in the bound working directory. Requires user approval.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'run_command', description: 'Run a shell command from the bound working directory. Requires user approval.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  {
    name: 'search_web',
    description:
      'Search the web. Returns numbered titles, URLs and summaries/snippets. Read-only. When citing a result in the final answer, insert <ref url="EXACT_URL" title="short title">optional snippet</ref> (or <ref_link>URL</ref_link>) immediately after the claim—do not invent bare [1] without a ref tag.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch a URL and return its text/Markdown content. Read-only. If you rely on this page in the answer, cite it with <ref url="that URL" title="...">...</ref>.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  LOAD_SKILL_TOOL,
]

export interface ToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
  blockIndex: number
}

const TOOL_DETAIL_MAX = 4000
/** 分页读文件后单页可到约 80KB；此处留余量，避免 harness 再砍掉续读提示 */
const TOOL_RESULT_MAX = 100_000

export function summarizeInput(input: Record<string, unknown>): string {
  if (typeof input.id === 'string' && input.id.trim()) {
    const file = typeof input.file === 'string' && input.file.trim() ? `/${input.file.trim()}` : ''
    const s = `${input.id.trim()}${file}`
    return s.length > 80 ? `${s.slice(0, 79)}…` : s
  }
  const cand =
    input.command ?? input.cmd ?? input.path ?? input.file_path ?? input.filePath ?? input.query ?? input.url
  let s = (typeof cand === 'string' ? cand : JSON.stringify(input)).replace(/\s+/g, ' ').trim()
  if (typeof input.offset === 'number' || typeof input.limit === 'number') {
    s = `${s} @${input.offset ?? 1}+${input.limit ?? 2000}`
  }
  return s.length > 80 ? `${s.slice(0, 79)}…` : s
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… (truncated, ${s.length} chars total)` : s
}

/**
 * 执行单个工具调用：发 tool_status 事件、调 executor、更新 tool 块、
 * 生成 tool_result 块、触发 onToolStart/onToolEnd 钩子。
 * aborted=true 表示 executor 被 abort（此时不产生 resultBlock，loop 直接收尾）。
 */
export async function executeToolCall(
  conv: Conversation,
  call: ToolCallInfo,
  agentNode: ConversationNode,
  executor: ToolExecutor | undefined,
  hooks: HookRunner,
  emit: (e: HarnessEvent) => void,
  signal: AbortSignal,
): Promise<{ resultBlock: Block | null; aborted: boolean }> {
  emit({ type: 'tool_status', convId: conv.id, nodeId: agentNode.id, blockIndex: call.blockIndex, status: 'running' })
  const t0 = Date.now()
  const block = agentNode.blocks[call.blockIndex]
  await hooks.run('onToolStart', conv, agentNode, call)
  try {
    const out = executor ? await executor(call.name, call.input, signal, conv) : 'tool not available'
    if (block?.type === 'tool') {
      block.status = 'done'
      block.detail = truncate(out, TOOL_DETAIL_MAX)
      block.stats = `${((Date.now() - t0) / 1000).toFixed(1)}s`
    }
    const resultBlock: Block = {
      type: 'tool_result',
      tool: call.name,
      toolUseId: call.id,
      content: truncate(out, TOOL_RESULT_MAX),
    }
    emit({ type: 'tool_status', convId: conv.id, nodeId: agentNode.id, blockIndex: call.blockIndex, status: 'done' })
    await hooks.run('onToolEnd', conv, agentNode, call, { output: out, durationMs: Date.now() - t0, isError: false })
    emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })
    return { resultBlock, aborted: false }
  } catch (err) {
    if (signal.aborted) {
      if (block?.type === 'tool') {
        block.status = 'error'
        block.detail = 'aborted'
      }
      emit({ type: 'tool_status', convId: conv.id, nodeId: agentNode.id, blockIndex: call.blockIndex, status: 'error' })
      await hooks.run('onToolEnd', conv, agentNode, call, { output: 'aborted', durationMs: Date.now() - t0, isError: true })
      emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })
      return { resultBlock: null, aborted: true }
    }
    const msg = toError(err).message
    if (block?.type === 'tool') {
      block.status = 'error'
      block.detail = msg
    }
    const resultBlock: Block = { type: 'tool_result', tool: call.name, toolUseId: call.id, content: msg, isError: true }
    emit({ type: 'tool_status', convId: conv.id, nodeId: agentNode.id, blockIndex: call.blockIndex, status: 'error' })
    await hooks.run('onToolEnd', conv, agentNode, call, { output: msg, durationMs: Date.now() - t0, isError: true })
    emit({ type: 'node_updated', convId: conv.id, nodeId: agentNode.id })
    return { resultBlock, aborted: false }
  }
}

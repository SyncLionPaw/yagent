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

const SAVE_INSIGHT_BASE_DESC =
  'Optionally save a small tip the user likely does not already know but will find useful later. ' +
  'How many: zero, one, or several per turn—only when there is a real takeaway; never force a tip. ' +
  'Granularity: each call = one fine-grained idea. If you have three points, call three times; do not merge into one long note. ' +
  'Title names that idea; text preferably one short sentence (max two). ' +
  'category must be one of the user inspiration keywords (see enum / list). ' +
  'Not task status, praise, or restating the answer. Skip TODOs, paths, and anything already obvious. ' +
  'Entries show in the right panel 「收获」 for the user to triage (pass / keep); they may ignore them.'

/** 按用户「灵感」关键词组装 save_insight；category = 关键词本身 */
export function saveInsightToolDef(keywords: string[] = []): ToolDef {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean)
  const categoryProp: Record<string, unknown> = cleaned.length
    ? {
        type: 'string',
        enum: cleaned,
        description: `Must be exactly one inspiration keyword: ${cleaned.map((k) => `"${k}"`).join(', ')}`,
      }
    : {
        type: 'string',
        description:
          'Short category label. User has not set inspiration keywords yet—use a brief theme name, or "未分类".',
      }
  const extra = cleaned.length
    ? ` Only save tips that fit these inspiration keywords; category must be one of them: ${cleaned
        .map((k) => `"${k}"`)
        .join(', ')}.`
    : ' User has not set inspiration keywords; still only save real takeaways and set a short category.'
  return {
    name: 'save_insight',
    description: SAVE_INSIGHT_BASE_DESC + extra,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Name of this single idea only (≤ 20 characters), e.g. "rebase 改历史"',
        },
        text: {
          type: 'string',
          description: 'This tip only: preferably one sentence, never more than two',
        },
        category: categoryProp,
        why: {
          type: 'string',
          description: 'Optional one-liner: why this tip matters',
        },
      },
      required: ['title', 'text', 'category'],
    },
  }
}

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
  {
    name: 'run_command',
    description: 'Run a shell command from the bound working directory. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        desc: {
          type: 'string',
          description: 'Short phrase naming the intent of this command (shown to the user for approval)',
        },
      },
      required: ['command', 'desc'],
    },
  },
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
  {
    name: 'ask_user_question',
    description:
      'Ask the user multiple-choice questions to gather preferences, clarify ambiguity, or choose between approaches. ' +
      'Use when a decision from the user is needed before continuing. Users can always pick "Other" for free text. ' +
      'Prefer recommending an option by listing it first and appending "(Recommended)" to its label. ' +
      'Do not use this for yes/no plan approval filler — only when a real choice is required.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1–4 questions to ask in one step',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description:
                  'Full question text, clear and specific, ending with ?. Multi-select: phrase accordingly.',
              },
              header: {
                type: 'string',
                description: 'Very short chip label (max 12 characters), e.g. "Library", "Auth".',
              },
              options: {
                type: 'array',
                description: '2–4 distinct choices. Do not include an "Other" option — UI adds it.',
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: 'Concise choice label (1–5 words) shown to the user',
                    },
                    description: {
                      type: 'string',
                      description: 'What this option means or implies',
                    },
                  },
                  required: ['label', 'description'],
                },
              },
              multiSelect: {
                type: 'boolean',
                description: 'If true, user may select multiple options (not mutually exclusive)',
              },
            },
            required: ['question', 'header', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
  saveInsightToolDef(),
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
  if (Array.isArray(input.questions)) {
    const headers = input.questions
      .map((q) => (q && typeof q === 'object' && typeof (q as { header?: unknown }).header === 'string'
        ? (q as { header: string }).header.trim()
        : ''))
      .filter(Boolean)
    if (headers.length) {
      const s = headers.join(' · ')
      return s.length > 80 ? `${s.slice(0, 79)}…` : s
    }
  }
  if (typeof input.title === 'string' && input.title.trim() && typeof input.text === 'string') {
    const s = input.title.trim()
    return s.length > 80 ? `${s.slice(0, 79)}…` : s
  }
  if (typeof input.desc === 'string' && input.desc.trim()) {
    const s = input.desc.trim().replace(/\s+/g, ' ')
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

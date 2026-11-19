import type { Block } from '@yagent/core'

/** 一轮过程的收起文案。进行中不使用。 */
export type ProcessTone = 'running' | 'stopped' | 'failed' | 'done'

export function processTone(blocks: readonly Block[], streaming: boolean, paused: boolean): ProcessTone {
  if (streaming) return 'running'
  const tools = blocks.filter((b) => b.type === 'tool')
  if (paused || tools.some((b) => b.type === 'tool' && b.detail === 'aborted')) return 'stopped'
  if (tools.some((b) => b.type === 'tool' && b.status === 'error')) return 'failed'
  if (blocks.some((b) => b.type === 'text' && b.text.startsWith('[error]'))) return 'failed'
  return 'done'
}

/** 成功结束的轮次默认收起；进行中、已停止、失败保持展开。 */
export function processStartsOpen(tone: ProcessTone): boolean {
  return tone !== 'done'
}

export function processLabel(tone: ProcessTone, blocks: readonly Block[], durationMs?: number): string {
  const thoughts = blocks.filter((b) => b.type === 'thinking').length
  const tools = blocks.filter((b) => b.type === 'tool').length
  const parts: string[] = []
  if (tone === 'stopped') parts.push('已停止')
  else if (tone === 'failed') parts.push('失败')
  if (thoughts) parts.push(`${thoughts} 次思考`)
  if (tools) parts.push(`${tools} 次工具`)
  if (tone === 'done' && durationMs && durationMs > 0) {
    const seconds = durationMs / 1000
    const text = seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds))
    parts.push(`用了 ${text}s`)
  }
  return parts.join(' · ') || '已完成'
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return (newline === -1 ? text : text.slice(0, newline)).trim()
}

/** 流式时取最近一段已经写完的第一行。当前段还没有换行时返回空串。 */
export function latestCompletedParagraphFirstLine(text: string): string {
  let summary = ''
  let paragraphStart = 0
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g
  while (true) {
    const nextParagraph = separator.exec(text)
    const paragraphEnd = nextParagraph === null
      ? text.length
      : nextParagraph.index + nextParagraph[0].indexOf('\n')
    const newline = text.indexOf('\n', paragraphStart)
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim()
      if (candidate !== '') summary = candidate
    }
    if (nextParagraph === null) return summary
    paragraphStart = nextParagraph.index + nextParagraph[0].length
  }
}

/** 收起时的一行预览。流式优先用已写完的段落，否则用正在写的第一行。 */
export function thoughtPreview(text: string, running: boolean): string {
  const raw = running ? latestCompletedParagraphFirstLine(text) || firstLine(text) : firstLine(text)
  return raw.replaceAll('**', '').trim()
}

/** 单换行保留为 Markdown 硬换行；围栏代码块原样留下。 */
export function thinkingMarkdown(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/([^\n])\r?\n(?!\r?\n)/g, '$1  \n')))
    .join('')
}

const TOOL_LABELS: Record<string, string> = {
  run_command: '运行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  search_web: '搜索网页',
  fetch_url: '打开网页',
  ask_user_question: '向你提问',
  load_skill: '加载技能',
  save_insight: '记下收获',
}

export interface ToolFace {
  label: string
  summary: string
  tone: 'running' | 'stopped' | 'error' | 'ok'
  expandable: boolean
  exitCode: number | null
  command: string | null
  output: string | null
  terminal: boolean
}

function toolText(input: Record<string, unknown> | undefined, key: string): string {
  const value = input?.[key]
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function toolArg(tool: string, input: Record<string, unknown> | undefined, summary: string): string {
  const desc = toolText(input, 'desc')
  if (desc) return desc
  if (tool === 'run_command') return toolText(input, 'command') || summary
  if (tool === 'read_file' || tool === 'write_file') return toolText(input, 'path') || summary
  if (tool === 'search_web') return toolText(input, 'query') || summary
  if (tool === 'fetch_url') return toolText(input, 'url') || summary
  return summary
}

function parseExit(detail: string | undefined): number | null {
  if (!detail) return null
  const matched = detail.match(/\[exit ([^\]]+)\][^\n]*$/)
  if (!matched || matched[1] === 'timeout') return null
  const code = Number(matched[1])
  return Number.isInteger(code) ? code : null
}

function stripExitFooter(detail: string): string {
  return detail.replace(/\n?\[exit [^\]]+\][^\n]*$/, '').trimEnd()
}

function firstErrorLine(detail: string | undefined): string {
  if (!detail) return ''
  return detail.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

export function toolFace(
  tool: string,
  summary: string,
  status: 'running' | 'done' | 'error',
  detail: string | undefined,
  input: Record<string, unknown> | undefined,
): ToolFace {
  const terminal = tool === 'run_command'
  const arg = toolArg(tool, input, summary)
  const command = terminal ? toolText(input, 'command') : ''
  const exitCode = terminal ? parseExit(detail) : null
  const aborted = detail === 'aborted'
  const tone = status === 'running'
    ? 'running'
    : aborted
      ? 'stopped'
      : status === 'error' || (exitCode !== null && exitCode !== 0)
        ? 'error'
        : 'ok'
  const shown = tone === 'stopped'
    ? '已停止'
    : tone === 'error' && exitCode === null
      ? firstErrorLine(detail) || arg
      : arg
  const output = detail && !aborted ? stripExitFooter(detail).trim() : ''
  const expandable = status !== 'running' && output.length > 0 && (terminal || output !== shown)
  return {
    label: TOOL_LABELS[tool] ?? tool,
    summary: shown,
    tone,
    expandable,
    exitCode,
    command: command || null,
    output: expandable ? output : null,
    terminal,
  }
}

import { describe, expect, it } from 'vitest'
import {
  latestCompletedParagraphFirstLine,
  processLabel,
  processStartsOpen,
  processTone,
  thinkingMarkdown,
  thoughtPreview,
  toolFace,
} from './processView'
import type { Block } from '@yagent/core'

const thinking = (text: string, status: 'streaming' | 'done' = 'done'): Block => ({
  type: 'thinking',
  text,
  status,
})

const tool = (
  name: string,
  status: 'running' | 'done' | 'error',
  detail?: string,
): Block => ({
  type: 'tool',
  tool: name,
  summary: 'desc',
  status,
  detail,
})

describe('process tone', () => {
  it('keeps a running turn open and labels a finished one with duration', () => {
    const blocks = [thinking('a'), tool('run_command', 'done', 'ok\n[exit 0]')]
    expect(processTone(blocks, true, false)).toBe('running')
    expect(processStartsOpen('running')).toBe(true)
    expect(processTone(blocks, false, false)).toBe('done')
    expect(processStartsOpen('done')).toBe(false)
    expect(processLabel('done', blocks, 3200)).toBe('1 次思考 · 1 次工具 · 用了 3.2s')
    expect(processLabel('done', [tool('run_command', 'done', 'ok\n[exit 0]')], 12400)).toBe('1 次工具 · 用了 12s')
  })

  it('treats an abort as stopped and a tool error as failed', () => {
    expect(processTone([tool('run_command', 'error', 'aborted')], false, false)).toBe('stopped')
    expect(processTone([tool('read_file', 'done')], false, true)).toBe('stopped')
    expect(processLabel('stopped', [thinking('a'), tool('run_command', 'error', 'aborted')])).toBe('已停止 · 1 次思考 · 1 次工具')
    expect(processTone([tool('read_file', 'error', 'missing')], false, false)).toBe('failed')
    expect(processStartsOpen('failed')).toBe(true)
    expect(processLabel('failed', [tool('read_file', 'error', 'missing')], 2000)).toBe('失败 · 1 次工具')
  })
})

describe('thought preview', () => {
  it('shows the latest finished paragraph while streaming, then the first line', () => {
    const text = '先看配置\n再核对端口\n\n还在写这一段'
    expect(latestCompletedParagraphFirstLine(text)).toBe('先看配置')
    expect(thoughtPreview(text, true)).toBe('先看配置')
    expect(thoughtPreview('还在写第一行', true)).toBe('还在写第一行')
    expect(thoughtPreview('**结论**\n后面', false)).toBe('结论')
  })

  it('keeps single newlines as markdown hard breaks outside code fences', () => {
    expect(thinkingMarkdown('第一行\n第二行')).toBe('第一行  \n第二行')
    expect(thinkingMarkdown('```\n第一行\n第二行\n```')).toBe('```\n第一行\n第二行\n```')
  })
})

describe('tool face', () => {
  it('shows the command description and keeps permission lines out of the diff', () => {
    const face = toolFace(
      'run_command',
      '列出目录',
      'done',
      '-rw-r--r--  file\n[exit 0]',
      { command: 'ls -l', desc: '列出目录' },
    )
    expect(face.label).toBe('运行命令')
    expect(face.summary).toBe('列出目录')
    expect(face.command).toBe('ls -l')
    expect(face.exitCode).toBe(0)
    expect(face.output).toBe('-rw-r--r--  file')
    expect(face.terminal).toBe(true)
    expect(face.tone).toBe('ok')
  })

  it('marks a nonzero exit on the badge and keeps the command', () => {
    const face = toolFace('run_command', '跑一下', 'done', 'nope\n[exit 1] (cube)', { command: 'false' })
    expect(face.tone).toBe('error')
    expect(face.summary).toBe('false')
    expect(face.exitCode).toBe(1)
    expect(face.output).toBe('nope')
  })

  it('is not expandable while running or when the only text is the summary', () => {
    expect(toolFace('read_file', 'a.ts', 'running', undefined, { path: 'a.ts' }).expandable).toBe(false)
    const stopped = toolFace('run_command', 'ls', 'error', 'aborted', { command: 'ls' })
    expect(stopped.tone).toBe('stopped')
    expect(stopped.summary).toBe('已停止')
    expect(stopped.expandable).toBe(false)
    const failed = toolFace('read_file', 'a.ts', 'error', 'File not found', { path: 'a.ts' })
    expect(failed.summary).toBe('File not found')
    expect(failed.expandable).toBe(false)
  })

  it('uses the path or query instead of the raw tool id', () => {
    expect(toolFace('read_file', 'notes', 'done', 'hello', { path: 'src/a.ts' }).label).toBe('读取文件')
    expect(toolFace('search_web', 'q', 'done', '1. result', { query: 'cubesandbox' }).summary).toBe('cubesandbox')
  })
})

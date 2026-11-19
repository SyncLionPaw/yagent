import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Block, Conversation } from '@yagent/core'
import { ChatView } from './ChatView'

function present(text: string) {
  if (!screen.queryByText(text)) throw new Error(`missing ${text}`)
}

function absent(text: string | RegExp) {
  if (screen.queryByText(text)) throw new Error(`unexpected ${String(text)}`)
}

function conversation(status: Conversation['status'], blocks: Conversation['nodes'][string]['blocks']): Conversation {
  return {
    id: 'c',
    title: 't',
    workdir: null,
    nodes: {
      n: {
        id: 'n',
        parentId: null,
        role: 'round',
        createdAt: 1,
        durationMs: 3200,
        blocks,
      },
    },
    activeNodeId: 'n',
    status,
    refs: [],
    attachments: [],
    outputs: [],
  }
}

const base: Block[] = [
  { type: 'text', text: '看一下目录' },
  { type: 'thinking', text: '先列文件\n再看权限', status: 'done' },
  {
    type: 'tool',
    tool: 'run_command',
    summary: '列出目录',
    status: 'done',
    detail: '-rw-r--r--  file\n[exit 0]',
    stats: '0.2s',
    input: { command: 'ls -l', desc: '列出目录' },
  },
  { type: 'text', text: '目录里有一个文件。' },
]

describe('chat process', () => {
  it('keeps thinking and the command visible while the turn is running', () => {
    render(
      <ChatView
        conversation={conversation('running', [
          { type: 'text', text: '看一下目录' },
          { type: 'thinking', text: '先列文件\n再看权限', status: 'streaming' },
          {
            type: 'tool',
            tool: 'run_command',
            summary: '列出目录',
            status: 'running',
            input: { command: 'ls -l', desc: '列出目录' },
          },
        ])}
        onRefClick={() => {}}
        onToggleFiles={() => {}}
      />,
    )
    present('先列文件')
    present('列出目录')
    absent('ls -l')
    present('运行中')
    absent('用了 3.2s')
  })

  it('folds a finished turn to the duration and opens the command as a terminal', () => {
    render(<ChatView conversation={conversation('done', base)} onRefClick={() => {}} onToggleFiles={() => {}} />)
    present('目录里有一个文件。')
    absent('列出目录')
    fireEvent.click(screen.getByRole('button', { name: '1 次思考 · 1 次工具 · 用了 3.2s' }))
    present('列出目录')
    absent('ls -l')
    present('先列文件')
    absent('-rw-r--r--  file')
    fireEvent.click(document.querySelector('.thought-head')!)
    if (!document.querySelector('.thought-body br')) throw new Error('thinking kept the single newline')
    const time = document.querySelector('.t-time')
    if (time?.textContent !== '0.2s' || !time.className.includes('tone-ok')) throw new Error('missing green duration')
    fireEvent.click(screen.getByRole('button', { name: /运行命令/ }))
    const output = document.querySelector('.tool-detail pre')
    expect(output?.textContent).toContain('-rw-r--r--')
    expect(output?.className).not.toContain('dl-del')
    expect(document.querySelector('.dl-del')).toBeNull()
  })

  it('leaves a failed turn open and puts the error on the row', () => {
    render(
      <ChatView
        conversation={conversation('done', [
          base[0],
          {
            type: 'tool',
            tool: 'read_file',
            summary: 'a.ts',
            status: 'error',
            detail: 'File not found\npath a.ts',
            stats: '0.4s',
            input: { path: 'a.ts' },
          },
        ])}
        onRefClick={() => {}}
        onToggleFiles={() => {}}
      />,
    )
    present('File not found')
    present('读取文件')
    if (!document.querySelector('.tool.is-plain')) throw new Error('tool still boxed')
    const failedTime = document.querySelector('.t-time')
    if (failedTime?.textContent !== '0.4s' || !failedTime.className.includes('tone-error')) {
      throw new Error('missing red duration')
    }
    fireEvent.click(screen.getByRole('button', { name: '失败 · 1 次工具' }))
    absent('File not found')
  })
})

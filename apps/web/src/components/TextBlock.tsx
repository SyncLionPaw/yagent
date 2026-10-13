import type { ReactNode } from 'react'

interface TextBlockProps {
  text: string
  onRefClick?: (id: number) => void
}

/** 渲染 agent 正文：\n\n 分段，"N. " 连续行成有序列表，`code` 行内代码，[n] 引用角标 */
export function TextBlock({ text, onRefClick }: TextBlockProps) {
  const paragraphs = text.split('\n\n')
  return (
    <>
      {paragraphs.map((para, i) => {
        const lines = para.split('\n')
        const isList = lines.length > 1 && lines.every((l) => /^\d+\.\s/.test(l))
        if (isList) {
          return (
            <ol key={i}>
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\d+\.\s/, ''), onRefClick)}</li>
              ))}
            </ol>
          )
        }
        return <p key={i}>{renderInline(para.replace(/\n/g, ' '), onRefClick)}</p>
      })}
    </>
  )
}

function renderInline(text: string, onRefClick?: (id: number) => void): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\[\d+\])/g)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>
    }
    const refMatch = /^\[(\d+)\]$/.exec(part)
    if (refMatch) {
      const id = Number(refMatch[1])
      return (
        <a key={i} className="ref" onClick={() => onRefClick?.(id)}>
          {id}
        </a>
      )
    }
    return <span key={i}>{part}</span>
  })
}

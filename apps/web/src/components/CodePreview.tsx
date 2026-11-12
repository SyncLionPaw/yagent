import { useEffect, useMemo, useState } from 'react'
import { highlightCode, langFromFilename } from '../lib/highlight'

/** 超过此体积先出纯文本，避免 hljs 同步卡主线程 */
const HIGHLIGHT_MAX = 120_000

function splitLines(text: string): string[] {
  if (!text) return ['']
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines.length ? lines : ['']
}

/** 文件面板源码预览：折行只改样式，DOM/字体不变 */
export function CodePreview({
  content,
  filename,
  wrap = false,
}: {
  content: string
  filename: string
  wrap?: boolean
}) {
  const lang = useMemo(() => langFromFilename(filename), [filename])
  const lines = useMemo(() => splitLines(content), [content])
  const [hiliteLines, setHiliteLines] = useState<string[] | null>(null)

  useEffect(() => {
    setHiliteLines(null)
    if (!lang || content.length > HIGHLIGHT_MAX) return
    let cancelled = false
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        const full = highlightCode(content, lang)
        if (cancelled || !full) return
        const parts = full.split('\n')
        if (content.endsWith('\n') && parts.length > 0 && parts[parts.length - 1] === '') {
          parts.pop()
        }
        if (parts.length !== lines.length) return
        setHiliteLines(parts)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [content, lang, lines.length])

  return (
    <div className={`file-view file-view-code file-view-fade${wrap ? ' is-wrap' : ''}`}>
      <div className="fvc-lines">
        {lines.map((line, i) => (
          <div className="fvc-row" key={i}>
            <span className="fvc-no" aria-hidden="true">
              {i + 1}
            </span>
            {hiliteLines ? (
              <code
                className={`fvc-line hljs${lang ? ` language-${lang}` : ''}`}
                dangerouslySetInnerHTML={{ __html: hiliteLines[i] || ' ' }}
              />
            ) : (
              <code className="fvc-line">{line.length ? line : ' '}</code>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

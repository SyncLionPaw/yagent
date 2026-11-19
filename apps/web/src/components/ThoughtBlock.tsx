import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, Lightbulb } from 'lucide-react'
import { thinkingMarkdown, thoughtPreview } from '../lib/processView'

interface ThoughtBlockProps {
  text: string
  status: 'streaming' | 'done'
}

/** 思考一行：默认收起，预览一行；点开后是保留单换行的 Markdown。 */
export function ThoughtBlock({ text, status }: ThoughtBlockProps) {
  const [open, setOpen] = useState(false)
  const running = status === 'streaming'
  const preview = thoughtPreview(text, running)

  return (
    <div className={`thought${open ? ' open' : ''}${running ? ' streaming' : ''}`}>
      <button type="button" className="thought-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Lightbulb className="ic ic-sm" />
        <span className="thought-title">思考</span>
        {preview ? (
          <span className={`thought-preview${running ? ' live' : ''}`} title={preview}>
            {preview}
          </span>
        ) : running ? (
          <span className="ring" />
        ) : null}
        {running && preview ? <span className="stream-caret" /> : null}
        <span className="caret">
          <ChevronDown className="ic ic-sm" />
        </span>
      </button>
      {open && text ? (
        <div className="thought-body md">
          <Markdown remarkPlugins={[remarkGfm]}>{thinkingMarkdown(text)}</Markdown>
        </div>
      ) : null}
    </div>
  )
}

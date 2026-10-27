import { useState } from 'react'
import { ChevronDown, Lightbulb } from 'lucide-react'

interface ThoughtBlockProps {
  text: string
  status: 'streaming' | 'done'
  durationMs?: number
}

/** thinking 块：流式中 = spinner + 灰字单行；完成后折叠为一行，点击展开左竖线引用块 */
export function ThoughtBlock({ text, status, durationMs }: ThoughtBlockProps) {
  const [open, setOpen] = useState(false)

  if (status === 'streaming') {
    // 无文字时转圈；开始流出文字后换成低调的光标，避免圆圈一直挂在文本旁
    return (
      <div className="thinking">
        {text ? (
          <>
            {text}
            <span className="stream-caret"></span>
          </>
        ) : (
          <span className="ring"></span>
        )}
      </div>
    )
  }

  return (
    <div className={`thought${open ? ' open' : ''}`}>
      <div className="thought-head" onClick={() => setOpen((v) => !v)}>
        <Lightbulb className="ic ic-sm" />
        思考过程{durationMs ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}
        <span className="caret">
          <ChevronDown className="ic ic-sm" style={{ transform: 'rotate(-90deg)' }} />
        </span>
      </div>
      <div className="thought-body">
        {text.split('\n\n').map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  )
}

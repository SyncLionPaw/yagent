import { useEffect, useRef } from 'react'

interface EditableTitleProps {
  title: string
  onCommit: (title: string) => void
}

/** 顶栏标题就地编辑：Enter/失焦保存，Esc 取消，空值回退，IME 组词期间 Enter 不触发 */
export function EditableTitle({ title, onCommit }: EditableTitleProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const beforeRef = useRef(title)

  // 外部切换会话/重命名后同步 DOM（contentEditable 不受 React 管控）
  useEffect(() => {
    if (ref.current && ref.current.textContent !== title) {
      ref.current.textContent = title
    }
  }, [title])

  return (
    <span
      ref={ref}
      className="title"
      contentEditable
      spellCheck={false}
      suppressContentEditableWarning
      onFocus={() => {
        beforeRef.current = ref.current?.textContent ?? ''
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
        if (e.key === 'Enter') {
          e.preventDefault()
          ref.current?.blur()
        }
        if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = beforeRef.current
          ref.current?.blur()
        }
      }}
      onBlur={() => {
        const el = ref.current
        if (!el) return
        const v = (el.textContent ?? '').trim()
        if (!v) {
          el.textContent = beforeRef.current
          return
        }
        el.textContent = v
        if (v !== beforeRef.current) onCommit(v)
      }}
    >
      {title}
    </span>
  )
}

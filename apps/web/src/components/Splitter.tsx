import { useEffect, useRef } from 'react'

export const SIDEBAR_W_DEFAULT = 236
export const PANEL_W_DEFAULT = 288
export const SIDEBAR_W_MIN = 180
export const SIDEBAR_W_MAX = 420
export const PANEL_W_MIN = 240
export const PANEL_W_MAX = 520

interface SplitterProps {
  /** left = 拖右边加宽侧栏；right = 拖左边加宽右栏 */
  edge: 'left' | 'right'
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (w: number) => void
  /** 松手后持久化；双击重置也会调 */
  onCommit?: (w: number) => void
}

/** 竖向推拉条：改侧栏 / 右栏宽度 */
export function Splitter({
  edge,
  value,
  min,
  max,
  defaultValue,
  onChange,
  onCommit,
}: SplitterProps) {
  const drag = useRef<{ startX: number; startW: number } | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.startX
      const next = clamp(d.startW + (edge === 'left' ? dx : -dx), min, max)
      onChange(next)
    }
    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      document.body.classList.remove('is-resizing')
      onCommit?.(valueRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [edge, min, max, onChange, onCommit])

  return (
    <div
      className={`splitter splitter-${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      title="拖动调整宽度 · 双击恢复默认"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        drag.current = { startX: e.clientX, startW: value }
        document.body.classList.add('is-resizing')
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onChange(defaultValue)
        onCommit?.(defaultValue)
      }}
    />
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

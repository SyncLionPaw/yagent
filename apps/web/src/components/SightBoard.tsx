import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Insight } from '@yagent/core'
import { Bookmark } from 'lucide-react'

interface SightBoardProps {
  open: boolean
  insights: Insight[]
  onMove?: (id: string, x: number, y: number) => void
}

const NOTE_W = 180

function defaultPos(i: number): { x: number; y: number } {
  const col = i % 4
  const row = Math.floor(i / 4)
  return {
    x: 20 + col * 196 + (i % 3) * 10,
    y: 18 + row * 132 + (i % 2) * 14,
  }
}

/** 主区上收后露出的收藏便签墙；便签可任意拖动 */
export function SightBoard({ open, insights, onMove }: SightBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({})
  const liveRef = useRef(live)
  liveRef.current = live
  const dragRef = useRef<{
    id: string
    pointerId: number
    grabX: number
    grabY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  useEffect(() => {
    setLive((prev) => {
      const next: Record<string, { x: number; y: number }> = {}
      insights.forEach((ins, i) => {
        // 拖动中的位置优先保留；否则用已存坐标或默认摊开
        if (dragRef.current?.id === ins.id && prev[ins.id]) next[ins.id] = prev[ins.id]!
        else next[ins.id] = ins.board ?? prev[ins.id] ?? defaultPos(i)
      })
      return next
    })
  }, [insights])

  const clamp = (x: number, y: number, el: HTMLElement) => {
    const board = boardRef.current
    if (!board) return { x, y }
    const maxX = Math.max(0, board.clientWidth - el.offsetWidth)
    // 纵向可拖出当前可视高度，便签板会跟着撑高
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.max(0, y),
    }
  }

  const boardMinH = useMemo(() => {
    let max = 280
    insights.forEach((ins, i) => {
      const p = live[ins.id] ?? ins.board ?? defaultPos(i)
      max = Math.max(max, p.y + 150)
    })
    return max
  }, [insights, live])

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string, index: number) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    const board = boardRef.current
    if (!board) return
    const origin = liveRef.current[id] ?? insights[index]?.board ?? defaultPos(index)
    const area = board.getBoundingClientRect()
    // 用 left/top 算抓取点，避开 rotate 后 getBoundingClientRect 导致的点击瞬移
    dragRef.current = {
      id,
      pointerId: e.pointerId,
      grabX: e.clientX - (area.left + origin.x - board.scrollLeft),
      grabY: e.clientY - (area.top + origin.y - board.scrollTop),
      originX: origin.x,
      originY: origin.y,
      moved: false,
    }
    setDraggingId(id)
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId || drag.id !== e.currentTarget.dataset.id) return
    const board = boardRef.current
    if (!board) return
    const area = board.getBoundingClientRect()
    const rawX = e.clientX - area.left + board.scrollLeft - drag.grabX
    const rawY = e.clientY - area.top + board.scrollTop - drag.grabY
    const next = clamp(rawX, rawY, e.currentTarget)
    if (!drag.moved) {
      const dx = next.x - drag.originX
      const dy = next.y - drag.originY
      if (dx * dx + dy * dy < 9) return // 点击抖动忽略
      drag.moved = true
    }
    setLive((m) => ({ ...m, [drag.id]: next }))
  }

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const pos = liveRef.current[drag.id]
    const moved = drag.moved
    dragRef.current = null
    setDraggingId(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      //
    }
    if (moved && pos) onMove?.(drag.id, Math.round(pos.x), Math.round(pos.y))
  }

  return (
    <section
      className={`sight-board${open ? ' open' : ''}`}
      aria-hidden={!open}
      aria-label="收藏便签"
    >
      <div className="sight-board-inner" ref={boardRef}>
        {!insights.length ? (
          <div className="sight-empty">
            <Bookmark className="ic sight-empty-ic" />
            <p>还没有收藏的收获</p>
            <span>在右侧「收获」里点收藏，会贴到这里</span>
          </div>
        ) : (
          <div className="sight-notes" style={{ minHeight: boardMinH }}>
            {insights.map((ins, i) => {
              const tilt = ((i % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7
              const p = live[ins.id] ?? ins.board ?? defaultPos(i)
              const dragging = draggingId === ins.id
              return (
                <article
                  key={ins.id}
                  data-id={ins.id}
                  className={`sight-note tone-${(i % 5) + 1} tilt-${tilt}${dragging ? ' dragging' : ''}`}
                  style={{
                    left: p.x,
                    top: p.y,
                    width: NOTE_W,
                    zIndex: dragging ? 20 : 1 + (i % 5),
                  }}
                  onPointerDown={(e) => onPointerDown(e, ins.id, i)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <div className="sight-note-head">
                    <h3 className="sight-note-title">{ins.title}</h3>
                    <span className="sight-note-cat">{ins.category}</span>
                  </div>
                  <p className="sight-note-text">{ins.text}</p>
                  {ins.why ? <p className="sight-note-why">{ins.why}</p> : null}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

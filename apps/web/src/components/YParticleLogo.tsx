import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Y_LOGO_GHOST, Y_LOGO_SELECTED } from '../lib/yLogoPattern'

type CellMeta = {
  id: string
  row: number
  col: number
  selected: boolean
  p1: number
  p2: number
  w1: number
  w2: number
}

const FORCE_RADIUS = 72
const MAX_SHIFT = 7
const DRIFT = 1.1

function buildCells(): CellMeta[] {
  const out: CellMeta[] = []
  for (let br = 0; br < 4; br++) {
    for (let bc = 0; bc < 4; bc++) {
      for (let sr = 0; sr < 4; sr++) {
        for (let sc = 0; sc < 4; sc++) {
          const id = `${br}-${bc}-${sr}-${sc}`
          out.push({
            id,
            row: br * 4 + sr,
            col: bc * 4 + sc,
            selected: Y_LOGO_SELECTED.has(id),
            p1: Math.random() * Math.PI * 2,
            p2: Math.random() * Math.PI * 2,
            w1: 0.4 + Math.random() * 0.6,
            w2: 0.4 + Math.random() * 0.6,
          })
        }
      }
    }
  }
  return out
}

/** 官网 index 同款粒子 𝑥：16×16 点阵 + 轻扰动 / 指针力场 */
export function YParticleLogo({ className }: { className?: string }) {
  const gridRef = useRef<HTMLDivElement>(null)
  const cells = useMemo(() => buildCells(), [])
  const mouseRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const root = gridRef.current
    if (!root) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const nodeList = Array.from(root.querySelectorAll<HTMLElement>('.yh-cell'))
    let raf = 0

    const tick = (t: number) => {
      const time = t / 1000
      const rect = root.getBoundingClientRect()
      const cs = nodeList[0]?.offsetWidth || 14
      const mouse = mouseRef.current
      for (let i = 0; i < nodeList.length; i++) {
        const el = nodeList[i]
        const meta = cells[i]
        let ox = Math.sin(time * meta.w1 + meta.p1) * DRIFT
        let oy = Math.cos(time * meta.w2 + meta.p2) * DRIFT
        let faint = 0
        if (mouse) {
          const cx = rect.left + meta.col * cs + cs / 2
          const cy = rect.top + meta.row * cs + cs / 2
          const dx = cx - mouse.x
          const dy = cy - mouse.y
          const d = Math.hypot(dx, dy)
          if (d < FORCE_RADIUS && d > 0.01) {
            const strength = (1 - d / FORCE_RADIUS) ** 2
            ox += (dx / d) * strength * MAX_SHIFT
            oy += (dy / d) * strength * MAX_SHIFT
            faint = 0.22 * (1 - d / FORCE_RADIUS)
          }
        }
        el.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`
        if (!meta.selected) {
          if (faint > 0.01) el.style.setProperty('--fo', faint.toFixed(3))
          else el.style.removeProperty('--fo')
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cells])

  return (
    <div
      ref={gridRef}
      className={`yh-grid${className ? ` ${className}` : ''}`}
      aria-hidden
      onMouseMove={(e) => {
        mouseRef.current = { x: e.clientX, y: e.clientY }
      }}
      onMouseLeave={() => {
        mouseRef.current = null
      }}
    >
      {Array.from({ length: 4 }, (_, br) =>
        Array.from({ length: 4 }, (_, bc) => (
          <div key={`${br}-${bc}`} className="yh-big">
            {Array.from({ length: 4 }, (_, sr) =>
              Array.from({ length: 4 }, (_, sc) => {
                const id = `${br}-${bc}-${sr}-${sc}`
                const selected = Y_LOGO_SELECTED.has(id)
                const ghost = Y_LOGO_GHOST.has(id)
                const row = br * 4 + sr
                const col = bc * 4 + sc
                const t = Math.hypot(row - 7.5, col - 7.5) / Math.hypot(7.5, 7.5)
                return (
                  <div
                    key={id}
                    className={`yh-cell${selected ? ' on' : ''}${ghost ? ' ghost' : ''}`}
                    style={
                      selected
                        ? ({ '--dot-t': t.toFixed(3) } as CSSProperties)
                        : undefined
                    }
                  />
                )
              }),
            )}
          </div>
        )),
      )}
    </div>
  )
}

/** 空会话 hero：官网大 logo + 一句标语；网格铺满 chat 并与 logo 对齐 */
export function EmptyChatHero() {
  const heroRef = useRef<HTMLDivElement>(null)
  const logoRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const align = () => {
      const hero = heroRef.current
      const logo = logoRef.current?.querySelector('.yh-grid') as HTMLElement | null
      const chat = hero?.closest('.chat') as HTMLElement | null
      if (!hero || !logo || !chat) return
      const cr = chat.getBoundingClientRect()
      const lr = logo.getBoundingClientRect()
      const cell = logo.querySelector('.yh-cell')?.getBoundingClientRect().width ?? 14
      chat.style.setProperty('--yh-cell', `${cell}px`)
      chat.style.setProperty('--yh-ox', `${lr.left - cr.left}px`)
      chat.style.setProperty('--yh-oy', `${lr.top - cr.top}px`)
    }
    align()
    const ro = new ResizeObserver(align)
    const chat = heroRef.current?.closest('.chat') as HTMLElement | null
    if (chat) ro.observe(chat)
    if (logoRef.current) ro.observe(logoRef.current)
    window.addEventListener('resize', align)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', align)
      chat?.style.removeProperty('--yh-cell')
      chat?.style.removeProperty('--yh-ox')
      chat?.style.removeProperty('--yh-oy')
    }
  }, [])

  return (
    <div className="chat-hero" ref={heroRef}>
      <div ref={logoRef}>
        <YParticleLogo />
      </div>
      <h2 className="chat-hero-title">说出目标，剩下的交给它。</h2>
      <p className="chat-hero-sub">在下方输入，开始新的对话或任务</p>
    </div>
  )
}

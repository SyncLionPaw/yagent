import { Check, GalleryHorizontal, Maximize2, RectangleHorizontal } from 'lucide-react'
import type { ContentWidth } from '@yagent/core'

const WIDTHS: {
  id: ContentWidth
  label: string
  desc: string
  icon: typeof RectangleHorizontal
}[] = [
  { id: 'standard', label: '标准', desc: '700px · 默认阅读宽度', icon: RectangleHorizontal },
  { id: 'wide', label: '加宽', desc: '960px · 宽屏更舒展', icon: GalleryHorizontal },
  { id: 'full', label: '全宽', desc: '铺满主区域', icon: Maximize2 },
]

interface WidthPickerProps {
  value: ContentWidth
  open: boolean
  onToggle: () => void
  onSelect: (w: ContentWidth) => void
}

/** 对话内容列宽：标准 / 加宽 / 全宽 */
export function WidthPicker({ value, open, onToggle, onSelect }: WidthPickerProps) {
  const current = WIDTHS.find((w) => w.id === value) ?? WIDTHS[0]
  const Icon = current.icon
  return (
    <div className="model-wrap">
      <button
        className={`icon-btn${open ? ' active' : ''}`}
        title="内容宽度"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        <Icon className="ic" />
      </button>
      <div className={`model-pop${open ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="pop-label">内容宽度</div>
        {WIDTHS.map((w) => {
          const WIcon = w.icon
          return (
            <button
              key={w.id}
              className={`mode-opt${w.id === value ? ' active' : ''}`}
              onClick={() => onSelect(w.id)}
            >
              <span className="m-icon">
                <WIcon className="ic" />
              </span>
              <span>
                <span className="m-title">{w.label}</span>
                <span className="m-desc">{w.desc}</span>
              </span>
              <span className="m-check">
                <Check className="ic ic-sm" />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

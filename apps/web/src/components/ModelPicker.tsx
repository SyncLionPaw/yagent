import { Check } from 'lucide-react'
import type { ModelConfig } from '@yagent/core'
import { BrandIcon } from './BrandIcons'

interface ModelPickerProps {
  models: ModelConfig[]
  currentId: string
  open: boolean
  onToggle: () => void
  onSelect: (id: string) => void
}

/** 模型选择：纯图标按钮（当前厂商 logo）+ 下拉列表 */
export function ModelPicker({ models, currentId, open, onToggle, onSelect }: ModelPickerProps) {
  const current = models.find((m) => m.id === currentId) ?? models[0]
  return (
    <div className="model-wrap">
      <button
        className="theme-toggle"
        title="切换模型"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {current && <BrandIcon provider={current.provider} />}
      </button>
      <div className={`model-pop${open ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="pop-label">选择模型</div>
        {models.map((m) => (
          <button
            key={m.id}
            className={`mode-opt${m.id === currentId ? ' active' : ''}`}
            onClick={() => onSelect(m.id)}
          >
            <span className="m-icon">
              <BrandIcon provider={m.provider} />
            </span>
            <span>
              <span className="m-title">{m.name}</span>
              <span className="m-desc">
                {m.provider} · {Math.round(m.context / 1000)}k 上下文
              </span>
            </span>
            <span className="m-check">
              <Check className="ic ic-sm" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

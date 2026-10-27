import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X } from 'lucide-react'
import { HTML_PREVIEW_SANDBOX } from '../lib/htmlPreview'
import { fileKindOf, formatSize } from '../lib/utils'
import { FileIcon } from './FileIcon'

/** 与 Composer / 气泡旁共用的缩略视觉 */
export type AttachVisual =
  | { type: 'image'; url: string }
  | { type: 'html'; html: string }
  | { type: 'md'; text: string }
  | { type: 'pdf'; url: string }
  | { type: 'cover' }

interface AttachPreviewCardProps {
  name: string
  size: number
  visual: AttachVisual
  title?: string
  onRemove?: () => void
  onClick?: () => void
}

export function AttachPreviewCard({
  name,
  size,
  visual,
  title,
  onRemove,
  onClick,
}: AttachPreviewCardProps) {
  const kind = fileKindOf(name)
  const ext = (name.split('.').pop() ?? '').toUpperCase().slice(0, 5) || 'FILE'
  const clickable = !!onClick

  return (
    <div
      className={`attach-card${clickable ? ' attach-card-click' : ''}`}
      title={title ?? `${name} · ${formatSize(size)}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      {onRemove && (
        <button
          type="button"
          className="attach-x"
          title="移除"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="ic ic-sm" />
        </button>
      )}
      <div className="attach-thumb">
        {visual.type === 'image' ? (
          <img src={visual.url} alt={name} />
        ) : visual.type === 'html' ? (
          <div className="attach-doc-preview">
            <iframe
              className="attach-doc-frame"
              title={name}
              sandbox={HTML_PREVIEW_SANDBOX}
              srcDoc={visual.html}
            />
          </div>
        ) : visual.type === 'md' ? (
          <div className="attach-doc-preview">
            {/* 缩略不用全局 .md（字号/代码块会在 scale 下炸版），只用紧凑 attach-md */}
            <div className="attach-doc-frame attach-md">
              <Markdown remarkPlugins={[remarkGfm]}>{visual.text}</Markdown>
            </div>
          </div>
        ) : visual.type === 'pdf' ? (
          <div className="attach-doc-preview">
            <iframe className="attach-doc-frame" title={name} src={visual.url} />
          </div>
        ) : (
          <div className={`attach-cover fi-${kind}`}>
            <FileIcon name={name} />
            <span className="attach-ext">{ext}</span>
          </div>
        )}
      </div>
      <div className="attach-meta">
        <span className="attach-name">{name}</span>
        <span className="attach-size">{formatSize(size)}</span>
      </div>
    </div>
  )
}

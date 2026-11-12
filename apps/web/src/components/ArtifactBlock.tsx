import { useState } from 'react'
import { Download, File, FileCode, Image as ImageIcon } from 'lucide-react'
import type { Artifact } from '@yagent/core'
import { formatDuration, formatSize } from '../lib/utils'

const KIND_LABEL: Record<Artifact['kind'], string> = {
  code: '代码',
  doc: '文档',
  html: 'HTML',
  image: '图片',
}

function kindIcon(kind: Artifact['kind']) {
  if (kind === 'image') return <ImageIcon className="ic" style={{ width: 20, height: 20 }} />
  if (kind === 'doc') return <File className="ic" style={{ width: 20, height: 20 }} />
  return <FileCode className="ic" style={{ width: 20, height: 20 }} />
}

function fileBase(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || name
}

interface ArtifactBlockProps {
  items: Artifact[]
  durationMs?: number
  onToggleFiles: () => void
  /** 下载单个产物（沙箱相对路径） */
  onDownload?: (name: string) => void | Promise<void>
}

/** Artifact 大卡片 + 操作排；点击卡片开关式联动右栏文件页 */
export function ArtifactBlock({ items, durationMs, onToggleFiles, onDownload }: ArtifactBlockProps) {
  const [busy, setBusy] = useState<string | null>(null)

  const downloadOne = async (name: string) => {
    if (!onDownload || busy) return
    setBusy(name)
    try {
      await onDownload(name)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {items.map((art) => (
        <div key={art.id} className="art-big" onClick={onToggleFiles}>
          <div className="art-thumb">{kindIcon(art.kind)}</div>
          <div>
            <div className="ab-name">{art.name}</div>
            <div className="ab-type">
              {KIND_LABEL[art.kind]} · {formatSize(art.size)}
            </div>
          </div>
          {onDownload ? (
            <button
              type="button"
              className="ab-more"
              title={`下载 ${fileBase(art.name)}`}
              disabled={busy === art.name}
              onClick={(e) => {
                e.stopPropagation()
                void downloadOne(art.name)
              }}
            >
              <Download className="ic ic-sm" />
            </button>
          ) : null}
        </div>
      ))}
      <div className="art-actions">
        {onDownload && items.length === 1 ? (
          <button
            type="button"
            className="icon-btn"
            title="下载"
            disabled={!!busy}
            onClick={() => void downloadOne(items[0].name)}
          >
            <Download className="ic ic-sm" />
          </button>
        ) : null}
        {durationMs != null && (
          <span className="done-inline">已完成 · 用时 {formatDuration(durationMs)}</span>
        )}
      </div>
    </>
  )
}

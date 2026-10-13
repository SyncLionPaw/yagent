import {
  Copy,
  Download,
  File,
  FileCode,
  Image as ImageIcon,
  MoreHorizontal,
  Share,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
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

interface ArtifactBlockProps {
  items: Artifact[]
  durationMs?: number
  onToggleFiles: () => void
}

/** Artifact 大卡片 + 操作排；点击卡片开关式联动右栏文件页 */
export function ArtifactBlock({ items, durationMs, onToggleFiles }: ArtifactBlockProps) {
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
          <button className="ab-more" title="更多">
            <MoreHorizontal className="ic ic-sm" />
          </button>
        </div>
      ))}
      <div className="art-actions">
        <button className="icon-btn" title="复制">
          <Copy className="ic ic-sm" />
        </button>
        <button className="icon-btn" title="有用">
          <ThumbsUp className="ic ic-sm" />
        </button>
        <button className="icon-btn" title="不行">
          <ThumbsDown className="ic ic-sm" />
        </button>
        <button className="icon-btn" title="分享">
          <Share className="ic ic-sm" />
        </button>
        <button className="icon-btn" title="下载">
          <Download className="ic ic-sm" />
        </button>
        <button className="icon-btn" title="更多">
          <MoreHorizontal className="ic ic-sm" />
        </button>
        {durationMs != null && (
          <span className="done-inline">已完成 · 用时 {formatDuration(durationMs)}</span>
        )}
      </div>
    </>
  )
}

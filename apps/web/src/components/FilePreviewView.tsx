import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HTML_PREVIEW_SANDBOX, htmlWithBase } from '../lib/htmlPreview'
import { formatSize } from '../lib/utils'
import { CodePreview } from './CodePreview'
import { MoleculeViewer } from './MoleculeViewer'

/** 与桌面端 fs:read 对齐；工作区 / 纯 chat 共用 */
export type FilePreview =
  | { name: string; kind: 'text'; content: string }
  | { name: string; kind: 'html'; content: string; baseHref?: string }
  | { name: string; kind: 'markdown'; content: string }
  | { name: string; kind: 'molecule'; format: string; content: string }
  | { name: string; kind: 'image'; mime: string; dataUrl: string }
  | { name: string; kind: 'pdf'; dataUrl: string }
  | { name: string; kind: 'unavailable'; reason: string; size: number }

export type FileViewMode = 'preview' | 'source'

export function canToggleSource(file: FilePreview | null | undefined): boolean {
  return !!file && (file.kind === 'html' || file.kind === 'markdown' || file.kind === 'molecule')
}

export function isShowingCode(
  file: FilePreview | null | undefined,
  viewMode: FileViewMode,
): boolean {
  if (!file) return false
  if (file.kind === 'text') return true
  return (
    (file.kind === 'html' || file.kind === 'markdown' || file.kind === 'molecule') &&
    viewMode === 'source'
  )
}

/** 工作区 / chat 共用的文件预览渲染（不含工具栏与路径解析） */
export function FilePreviewView({
  preview,
  opening = false,
  viewMode,
  wrap = false,
  fileName,
}: {
  preview: FilePreview | null
  opening?: boolean
  viewMode: FileViewMode
  wrap?: boolean
  fileName?: string | null
}) {
  const title = fileName || preview?.name || 'file'

  if (opening && !preview) {
    return <div className="file-view file-view-loading file-view-fade">加载预览…</div>
  }
  if (!preview) return null

  if (preview.kind === 'image') {
    return (
      <div className="file-view file-view-image file-view-fade">
        <img src={preview.dataUrl} alt={title} />
      </div>
    )
  }
  if (preview.kind === 'pdf') {
    return (
      <iframe className="file-view file-view-pdf file-view-fade" title={title} src={preview.dataUrl} />
    )
  }
  if (preview.kind === 'html' && viewMode === 'preview') {
    return (
      <iframe
        className="file-view file-view-html file-view-fade"
        title={title}
        sandbox={HTML_PREVIEW_SANDBOX}
        srcDoc={htmlWithBase(preview.content, preview.baseHref)}
      />
    )
  }
  if (preview.kind === 'markdown' && viewMode === 'preview') {
    return (
      <div className="file-view file-view-md file-view-fade md">
        <Markdown remarkPlugins={[remarkGfm]}>{preview.content}</Markdown>
      </div>
    )
  }
  if (preview.kind === 'molecule' && viewMode === 'preview') {
    return (
      <div className="file-view-fade">
        <MoleculeViewer content={preview.content} format={preview.format} />
      </div>
    )
  }
  if (preview.kind === 'unavailable') {
    return (
      <div className="file-view file-view-meta file-view-empty file-view-fade">
        <p className="file-view-empty-title">无法预览这种文件</p>
        <p className="file-view-empty-desc">
          {preview.reason || '暂不支持这种文件的格式、编码或大小。请使用其他应用打开。'}
          {preview.size ? ` · ${formatSize(preview.size)}` : ''}
        </p>
      </div>
    )
  }
  if ('content' in preview) {
    return <CodePreview content={preview.content} filename={title} wrap={wrap} />
  }
  return null
}

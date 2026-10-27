import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HTML_PREVIEW_SANDBOX, htmlWithBase } from '../lib/htmlPreview'
import { formatSize } from '../lib/utils'
import { FileIcon } from './FileIcon'

interface DirEntry {
  name: string
  isDir: boolean
  size: number
}

type FilePreview =
  | { name: string; kind: 'text'; content: string }
  | { name: string; kind: 'html'; content: string; baseHref?: string }
  | { name: string; kind: 'markdown'; content: string }
  | { name: string; kind: 'image'; mime: string; dataUrl: string }
  | { name: string; kind: 'pdf'; dataUrl: string }
  | { name: string; kind: 'unavailable'; reason: string; size: number }

/** 项目文件浏览（右栏文件页）：目录下钻；点文件以面包屑 tab 打开，支持文本 / 图片 / HTML / MD / PDF 预览 */
export function ProjectFiles({ workdir }: { workdir: string }) {
  const [rel, setRel] = useState('') // 当前目录（相对 workdir）
  const [file, setFile] = useState<FilePreview | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    setError('')
    window.yagentDesktop?.fs
      ?.list(workdir, rel)
      .then((list) => {
        if (!stale) setEntries(list)
      })
      .catch((err) => {
        if (!stale) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      stale = true
    }
  }, [workdir, rel])

  const openFile = useCallback(
    (name: string) => {
      const fileRel = rel ? `${rel}/${name}` : name
      setError('')
      window.yagentDesktop?.fs
        ?.read(workdir, fileRel)
        .then((preview) => {
          setViewMode('preview')
          setFile({ name: fileRel, ...preview })
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    },
    [workdir, rel],
  )

  const gotoDir = useCallback((dirRel: string) => {
    setFile(null)
    setRel(dirRel)
  }, [])

  const segments = rel ? rel.split('/') : []
  const fileName = file ? (file.name.split('/').pop() ?? file.name) : null
  const canToggleSource = file?.kind === 'html' || file?.kind === 'markdown'

  return (
    <div className="project-files">
      <div className="project-files-body">
        <div className="crumbs">
          {(rel || file) && (
            <button
              className="crumb-back"
              onClick={() => (file ? setFile(null) : gotoDir(segments.slice(0, -1).join('/')))}
            >
              <ArrowLeft className="ic ic-sm" />
            </button>
          )}
          <span className="crumb" onClick={() => gotoDir('')}>
            根目录
          </span>
          {segments.map((s, i) => (
            <span key={i}>
              <span className="crumb-sep">/</span>
              <span className="crumb" onClick={() => gotoDir(segments.slice(0, i + 1).join('/'))}>
                {s}
              </span>
            </span>
          ))}
          {fileName && (
            <span>
              <span className="crumb-sep">/</span>
              <span className="crumb crumb-tab current">{fileName}</span>
            </span>
          )}
        </div>

        {canToggleSource && (
          <div className="file-view-tabs">
            <button
              type="button"
              className={`fvt${viewMode === 'preview' ? ' on' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              预览
            </button>
            <button
              type="button"
              className={`fvt${viewMode === 'source' ? ' on' : ''}`}
              onClick={() => setViewMode('source')}
            >
              源码
            </button>
          </div>
        )}

        {error && <div className="files-note">{error}</div>}

        {file ? (
          file.kind === 'image' ? (
            <div className="file-view file-view-image">
              <img src={file.dataUrl} alt={fileName ?? ''} />
            </div>
          ) : file.kind === 'pdf' ? (
            <iframe className="file-view file-view-pdf" title={fileName ?? 'pdf'} src={file.dataUrl} />
          ) : file.kind === 'html' && viewMode === 'preview' ? (
            <iframe
              className="file-view file-view-html"
              title={fileName ?? 'html'}
              sandbox={HTML_PREVIEW_SANDBOX}
              srcDoc={htmlWithBase(file.content, file.baseHref)}
            />
          ) : file.kind === 'markdown' && viewMode === 'preview' ? (
            <div className="file-view file-view-md md">
              <Markdown remarkPlugins={[remarkGfm]}>{file.content}</Markdown>
            </div>
          ) : file.kind === 'unavailable' ? (
            <div className="file-view file-view-meta">
              <p>{file.reason}</p>
              <p>
                <span className="doc-meta-k">大小</span> {formatSize(file.size)}
              </p>
            </div>
          ) : (
            <pre className="file-view">{file.content}</pre>
          )
        ) : (
          <>
            {entries.map((e) => (
              <div
                className="sfile"
                key={e.name}
                onClick={() => (e.isDir ? gotoDir(rel ? `${rel}/${e.name}` : e.name) : openFile(e.name))}
              >
                {e.isDir ? <FolderOpen className="ic ic-sm" /> : <FileIcon name={e.name} />}
                <span className="sf-name">{e.name}</span>
                {!e.isDir && <span className="sf-meta">{formatSize(e.size)}</span>}
              </div>
            ))}
            {!error && entries.length === 0 && <div className="files-note">空目录</div>}
          </>
        )}
      </div>

      <div className="sub-label project-files-foot">
        项目文件 <span style={{ fontWeight: 400 }}>· {workdir}</span>
      </div>
    </div>
  )
}

import { useCallback, useState } from 'react'
import { ArrowLeft, Code2, Download, Eye } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SandboxFile } from '@yagent/core'
import { HTML_PREVIEW_SANDBOX, htmlWithBase } from '../lib/htmlPreview'
import { formatSize } from '../lib/utils'
import { CodePreview } from './CodePreview'
import { FileIcon } from './FileIcon'
import { MoleculeViewer } from './MoleculeViewer'

type FilePreview =
  | { name: string; kind: 'text'; content: string }
  | { name: string; kind: 'html'; content: string; baseHref?: string }
  | { name: string; kind: 'markdown'; content: string }
  | { name: string; kind: 'molecule'; format: string; content: string }
  | { name: string; kind: 'image'; mime: string; dataUrl: string }
  | { name: string; kind: 'pdf'; dataUrl: string }
  | { name: string; kind: 'unavailable'; reason: string; size: number }

function displayName(stored: string): string {
  const s = stored.trim()
  if (!s) return 'file'
  const parts = s.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || s
}

function isAbsPath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)
}

/** 纯 chat：附件 + 产物列表，点击预览（附件走 uploads 绝对路径，产物走会话沙箱） */
export function ChatSandboxFiles({
  convId,
  attachments,
  outputs,
}: {
  convId: string
  attachments: SandboxFile[]
  outputs: SandboxFile[]
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [previewSource, setPreviewSource] = useState<'attach' | 'output' | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const [error, setError] = useState('')
  const [busyDl, setBusyDl] = useState<string | null>(null)

  const downloadFile = useCallback(
    async (stored: string, source: 'attach' | 'output') => {
      const exportFile = window.yagentDesktop?.fs?.exportFile
      if (!exportFile) {
        setError('下载需要桌面端')
        return
      }
      setBusyDl(stored)
      setError('')
      try {
        const name = displayName(stored)
        let res: { ok: boolean; canceled?: boolean; error?: string }
        if (source === 'attach' && isAbsPath(stored)) {
          res = await exportFile({ absPath: stored, defaultName: name })
        } else {
          const box = await window.yagentDesktop?.sandbox?.ensure(convId)
          if (!box?.root) throw new Error('沙箱目录不可用')
          res = await exportFile({
            workdir: box.root,
            rel: stored.replace(/^\/+/, ''),
            defaultName: name,
          })
        }
        if (!res.ok && !res.canceled) setError(res.error || '下载失败')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyDl(null)
      }
    },
    [convId],
  )

  const openFile = useCallback(
    async (stored: string, source: 'attach' | 'output') => {
      const fsApi = window.yagentDesktop?.fs
      if (!fsApi?.read) {
        setError('文件预览需要桌面端')
        return
      }
      setError('')
      setViewMode('preview')
      setPreview(null)
      setPreviewSource(source)
      setOpening(stored)
      try {
        let workdir = ''
        let rel = stored
        if (source === 'attach' && isAbsPath(stored)) {
          workdir = ''
          rel = stored
        } else if (source === 'output') {
          const box = await window.yagentDesktop?.sandbox?.ensure(convId)
          if (!box?.root) throw new Error('沙箱目录不可用')
          workdir = box.root
          rel = stored.replace(/^\/+/, '')
        } else if (isAbsPath(stored)) {
          workdir = ''
          rel = stored
        } else {
          const box = await window.yagentDesktop?.sandbox?.ensure(convId)
          if (!box?.root) throw new Error('沙箱目录不可用')
          workdir = box.root
          rel = stored
        }
        const raw = await fsApi.read(workdir, rel)
        setPreview({ name: stored, ...raw })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPreview(null)
      } finally {
        setOpening(null)
      }
    },
    [convId],
  )

  const closePreview = () => {
    setPreview(null)
    setOpening(null)
    setPreviewSource(null)
    setError('')
  }

  const fileName = preview ? displayName(preview.name) : opening ? displayName(opening) : null
  const canToggleSource =
    !!preview &&
    (preview.kind === 'html' || preview.kind === 'markdown' || preview.kind === 'molecule')
  const showingCode =
    !!preview &&
    (preview.kind === 'text' ||
      ((preview.kind === 'html' || preview.kind === 'markdown' || preview.kind === 'molecule') &&
        viewMode === 'source'))

  if (preview || opening) {
    return (
      <div className="chat-sandbox-files">
        <div className="files-toolbar">
          <div className="crumbs">
            <button type="button" className="crumb-back" onClick={closePreview} title="返回列表">
              <ArrowLeft className="ic ic-sm" />
            </button>
            <span className="crumb crumb-tab current" title={preview?.name || opening || ''}>
              {fileName}
            </span>
          </div>
          <div className="file-view-tabs" role="group" aria-label="预览工具">
            {canToggleSource ? (
              <>
                <button
                  type="button"
                  className={`fvt fvt-icon${viewMode === 'preview' ? ' on' : ''}`}
                  title="预览"
                  aria-pressed={viewMode === 'preview'}
                  onClick={() => setViewMode('preview')}
                >
                  <Eye className="ic ic-sm" />
                </button>
                <button
                  type="button"
                  className={`fvt fvt-icon${viewMode === 'source' ? ' on' : ''}`}
                  title="源码"
                  aria-pressed={viewMode === 'source'}
                  onClick={() => setViewMode('source')}
                >
                  <Code2 className="ic ic-sm" />
                </button>
              </>
            ) : null}
            {preview && previewSource ? (
              <button
                type="button"
                className="fvt fvt-icon"
                title="下载"
                disabled={!!busyDl}
                onClick={() => void downloadFile(preview.name, previewSource)}
              >
                <Download className="ic ic-sm" />
              </button>
            ) : null}
          </div>
        </div>
        {error ? <div className="files-note">{error}</div> : null}
        {opening && !preview ? (
          <div className="file-view file-view-loading">加载预览…</div>
        ) : preview?.kind === 'image' ? (
          <div className="file-view file-view-image">
            <img src={preview.dataUrl} alt={fileName ?? ''} />
          </div>
        ) : preview?.kind === 'pdf' ? (
          <iframe className="file-view file-view-pdf" title={fileName ?? 'pdf'} src={preview.dataUrl} />
        ) : preview?.kind === 'html' && viewMode === 'preview' ? (
          <iframe
            className="file-view file-view-html"
            title={fileName ?? 'html'}
            sandbox={HTML_PREVIEW_SANDBOX}
            srcDoc={htmlWithBase(preview.content, preview.baseHref)}
          />
        ) : preview?.kind === 'markdown' && viewMode === 'preview' ? (
          <div className="file-view file-view-md md">
            <Markdown remarkPlugins={[remarkGfm]}>{preview.content}</Markdown>
          </div>
        ) : preview?.kind === 'molecule' && viewMode === 'preview' ? (
          <MoleculeViewer content={preview.content} format={preview.format} />
        ) : preview?.kind === 'unavailable' ? (
          <div className="file-view file-view-empty">
            <p className="file-view-empty-desc">
              {preview.reason}
              {preview.size ? ` · ${formatSize(preview.size)}` : ''}
            </p>
          </div>
        ) : showingCode && preview && 'content' in preview ? (
          <CodePreview content={preview.content} filename={fileName ?? 'file'} wrap={false} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="chat-sandbox-files">
      <div className="files-half">
        <div className="sub-label">
          用户附件 <span style={{ fontWeight: 400 }}>· 你上传的</span>
        </div>
        {attachments.length === 0 ? (
          <div className="files-note">还没有附件</div>
        ) : (
          attachments.map((f) => (
            <div key={`a:${f.name}`} className="sfile-row">
              <button
                type="button"
                className="sfile sfile-btn"
                title={f.name}
                onClick={() => void openFile(f.name, 'attach')}
              >
                <FileIcon name={displayName(f.name)} />
                <span className="sf-name">{displayName(f.name)}</span>
                <span className="sf-meta">{formatSize(f.size)}</span>
              </button>
              <button
                type="button"
                className="sfile-dl"
                title="下载"
                disabled={busyDl === f.name}
                onClick={(e) => {
                  e.stopPropagation()
                  void downloadFile(f.name, 'attach')
                }}
              >
                <Download className="ic ic-sm" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="files-divider" />

      <div className="files-half">
        <div className="sub-label">
          Agent 产物 <span style={{ fontWeight: 400 }}>· 本次任务生成</span>
        </div>
        {outputs.length === 0 ? (
          <div className="files-note">还没有产物</div>
        ) : (
          outputs.map((f) => (
            <div key={`o:${f.name}`} className="sfile-row">
              <button
                type="button"
                className="sfile sfile-btn"
                title={f.name}
                onClick={() => void openFile(f.name, 'output')}
              >
                <FileIcon name={displayName(f.name)} />
                <span className="sf-name">{displayName(f.name)}</span>
                <span className="sf-meta">{formatSize(f.size)}</span>
              </button>
              <button
                type="button"
                className="sfile-dl"
                title="下载"
                disabled={busyDl === f.name}
                onClick={(e) => {
                  e.stopPropagation()
                  void downloadFile(f.name, 'output')
                }}
              >
                <Download className="ic ic-sm" />
              </button>
            </div>
          ))
        )}
      </div>

      {error ? <div className="files-note">{error}</div> : null}
      <div className="files-note">
        纯对话使用本机进程隔离沙箱。点击文件可预览；此处不是完整文件系统。
      </div>
    </div>
  )
}

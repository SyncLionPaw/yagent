import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  Folder,
  FolderOpen,
  Terminal,
  WrapText,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isSshWorkdir } from '@yagent/core'
import { filesFromDataTransfer } from './Composer'
import { HTML_PREVIEW_SANDBOX, htmlWithBase } from '../lib/htmlPreview'
import { formatSize } from '../lib/utils'
import { CodePreview } from './CodePreview'
import { FileIcon } from './FileIcon'
import { MoleculeViewer } from './MoleculeViewer'

const DROP_MAX_BYTES = 20 * 1024 * 1024

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\u4e00-\u9fff()-]+/g, '_').replace(/^\.+/, '')
  return base || 'file'
}

/** 与目录已有项冲突时加 (1)(2)… */
function uniqueName(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted
  const dot = wanted.lastIndexOf('.')
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted
  const ext = dot > 0 ? wanted.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const next = `${stem} (${i})${ext}`
    if (!taken.has(next)) return next
  }
  return `${stem}-${Date.now()}${ext}`
}

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

interface DirEntry {
  name: string
  isDir: boolean
  size: number
}

type FilePreview =
  | { name: string; kind: 'text'; content: string }
  | { name: string; kind: 'html'; content: string; baseHref?: string }
  | { name: string; kind: 'markdown'; content: string }
  | { name: string; kind: 'molecule'; format: string; content: string }
  | { name: string; kind: 'image'; mime: string; dataUrl: string }
  | { name: string; kind: 'pdf'; dataUrl: string }
  | { name: string; kind: 'unavailable'; reason: string; size: number }

type DirCache = Record<string, DirEntry[] | 'loading' | string>

/** 项目文件：树形展开/折叠；点文件预览；可拖入复制到目录 */
export function ProjectFiles({
  workdir,
  /** SSH：仅 ok 时列目录，避免离线/探测中狂刷 fs:list → IPC 超时噪讯 */
  remoteFs = null,
}: {
  workdir: string
  remoteFs?: 'checking' | 'ok' | 'fail' | null
}) {
  const [file, setFile] = useState<FilePreview | null>(null)
  /** 正在打开的相对路径：立刻切到预览壳，避免干等 IPC */
  const [opening, setOpening] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const [wrap, setWrap] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [cache, setCache] = useState<DirCache>({})
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [dropRel, setDropRel] = useState('')
  const [dropping, setDropping] = useState(false)
  const [openMenuOpen, setOpenMenuOpen] = useState(false)
  const [openMenuBusy, setOpenMenuBusy] = useState(false)
  const [openMenuErr, setOpenMenuErr] = useState('')
  const [openApps, setOpenApps] = useState<
    { id: string; name: string; path: string; isDefault: boolean; iconDataUrl?: string }[]
  >([])
  const [systemIcons, setSystemIcons] = useState<{ reveal?: string; terminal?: string }>({})
  /** 文件树里选中的目录（相对路径；'' 表示工作区根，始终可打开） */
  const [selectedDir, setSelectedDir] = useState('')
  const openMenuRef = useRef<HTMLDivElement | null>(null)
  const dragDepth = useRef(0)
  const openSeq = useRef(0)
  /** 目录列表世代：换 workdir / 清树时递增，丢弃过期的 list 回包，避免串项目 */
  const listSeq = useRef(0)
  const isRemote = isSshWorkdir(workdir)
  const fsBlocked = isRemote && remoteFs != null && remoteFs !== 'ok'
  const canWrite = !!window.yagentDesktop?.fs?.write && !fsBlocked
  const canOpenMenu = !!window.yagentDesktop?.fs?.openMenu && !fsBlocked

  const loadDir = useCallback(
    async (dirRel: string) => {
      if (isRemote && remoteFs != null && remoteFs !== 'ok') {
        const msg =
          remoteFs === 'checking' ? '正在检测远程连接…' : '远程主机不可达，文件树暂不可用'
        setCache((c) => ({ ...c, [dirRel]: msg }))
        if (dirRel === '') setError(msg)
        return
      }
      const seq = listSeq.current
      setCache((c) => (c[dirRel] === 'loading' ? c : { ...c, [dirRel]: 'loading' }))
      try {
        const list = (await window.yagentDesktop?.fs?.list(workdir, dirRel)) ?? []
        if (seq !== listSeq.current) return
        setCache((c) => ({ ...c, [dirRel]: list }))
      } catch (err) {
        if (seq !== listSeq.current) return
        const msg = err instanceof Error ? err.message : String(err)
        setCache((c) => ({ ...c, [dirRel]: msg }))
        if (dirRel === '') setError(msg)
      }
    },
    [workdir, isRemote, remoteFs],
  )

  // 换项目 / 远程连通状态变化时清空树；仅在可访问时拉根目录
  useEffect(() => {
    openSeq.current += 1
    listSeq.current += 1
    setFile(null)
    setOpening(null)
    setError('')
    setOpenMenuOpen(false)
    setOpenMenuBusy(false)
    setOpenMenuErr('')
    setOpenApps([])
    setSystemIcons({})
    setSelectedDir('')
    setExpanded(new Set(['']))
    setCache({})
    void loadDir('')
  }, [workdir, loadDir, remoteFs])

  const previewRel = file?.name || opening || ''
  /** 打开方式目标：预览中的文件，否则为选中目录；未点选时默认工作区根 */
  const openTargetRel = previewRel || selectedDir
  const openTargetReady = canOpenMenu

  const loadOpenMenu = useCallback(async () => {
    if (!openTargetReady || !canOpenMenu) return
    setOpenMenuBusy(true)
    setOpenMenuErr('')
    try {
      const res = await window.yagentDesktop!.fs!.openMenu(workdir, openTargetRel)
      if (!res.ok) {
        setOpenApps([])
        setSystemIcons({})
        setOpenMenuErr(res.error || '无法获取打开方式')
        return
      }
      setOpenApps(res.apps || [])
      setSystemIcons(res.systemIcons || {})
    } catch (err) {
      setOpenApps([])
      setSystemIcons({})
      setOpenMenuErr(err instanceof Error ? err.message : String(err))
    } finally {
      setOpenMenuBusy(false)
    }
  }, [canOpenMenu, openTargetReady, openTargetRel, workdir])

  const toggleOpenMenu = useCallback(() => {
    setOpenMenuOpen((v) => {
      const next = !v
      if (next) void loadOpenMenu()
      return next
    })
  }, [loadOpenMenu])

  useEffect(() => {
    if (!openMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!openMenuRef.current?.contains(e.target as Node)) setOpenMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openMenuOpen])

  // 选中文件/目录后预取默认应用图标，工具栏按钮能立刻显示
  useEffect(() => {
    if (!openTargetReady || !canOpenMenu) return
    void loadOpenMenu()
  }, [openTargetReady, openTargetRel, canOpenMenu, loadOpenMenu])

  const runOpenAction = useCallback(
    async (action: 'app' | 'reveal' | 'terminal', appPath?: string) => {
      if (!openTargetReady) return
      setOpenMenuBusy(true)
      setOpenMenuErr('')
      try {
        const fsApi = window.yagentDesktop!.fs!
        const res =
          action === 'reveal'
            ? await fsApi.revealInFolder!(workdir, openTargetRel)
            : action === 'terminal'
              ? await fsApi.openParentInTerminal!(workdir, openTargetRel)
              : await fsApi.openWithApp(workdir, openTargetRel, appPath ?? null)
        if (!res.ok) setOpenMenuErr(res.error || '操作失败')
        else setOpenMenuOpen(false)
      } catch (err) {
        setOpenMenuErr(err instanceof Error ? err.message : String(err))
      } finally {
        setOpenMenuBusy(false)
      }
    },
    [openTargetReady, openTargetRel, workdir],
  )

  const refreshDir = useCallback(
    (dirRel: string) => {
      void loadDir(dirRel)
    },
    [loadDir],
  )

  const toggleDir = (dirRel: string) => {
    setSelectedDir(dirRel)
    setOpenMenuOpen(false)
    setOpenMenuErr('')
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dirRel)) next.delete(dirRel)
      else {
        next.add(dirRel)
        if (cache[dirRel] === undefined) void loadDir(dirRel)
      }
      return next
    })
  }

  const openFile = useCallback(
    (fileRel: string) => {
      const seq = ++openSeq.current
      setError('')
      setOpenMenuErr('')
      setOpenMenuOpen(false)
      setViewMode('preview')
      setFile(null)
      setOpening(fileRel)
      window.yagentDesktop?.fs
        ?.read(workdir, fileRel)
        .then((preview) => {
          if (seq !== openSeq.current) return
          setFile({ name: fileRel, ...preview })
          setOpening(null)
        })
        .catch((err) => {
          if (seq !== openSeq.current) return
          setOpening(null)
          setError(err instanceof Error ? err.message : String(err))
        })
    },
    [workdir],
  )

  const closeFile = useCallback(() => {
    openSeq.current += 1
    setOpening(null)
    setFile(null)
    setOpenMenuOpen(false)
  }, [])

  const onDragEnter = (e: DragEvent) => {
    if (!canWrite || dropping) return
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setDragOver(true)
  }

  const onDragOver = (e: DragEvent) => {
    if (!canWrite || dropping) return
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (e: DragEvent) => {
    if (!canWrite) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      setDragOver(false)
      setDropRel('')
    }
  }

  const copyFilesInto = async (dirRel: string, files: File[]) => {
    const write = window.yagentDesktop?.fs?.write
    if (!write) return
    const existing = cache[dirRel]
    const taken = new Set(
      Array.isArray(existing) ? existing.map((x) => x.name) : [],
    )
    const fails: string[] = []
    let wrote = 0
    for (const f of files) {
      if (f.size > DROP_MAX_BYTES) {
        fails.push(`${f.name} 超过 20MB`)
        continue
      }
      const name = uniqueName(safeFileName(f.name), taken)
      try {
        const b64 = await fileToBase64(f)
        await write(workdir, joinRel(dirRel, name), b64)
        taken.add(name)
        wrote += 1
      } catch (err) {
        fails.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (wrote) {
      setExpanded((prev) => new Set(prev).add(dirRel))
      refreshDir(dirRel)
    }
    if (fails.length) {
      setError(
        wrote
          ? `已复制 ${wrote} 个文件；失败：${fails.join('；')}`
          : `复制失败：${fails.join('；')}`,
      )
    } else {
      setError('')
    }
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    const target = dropRel
    setDragOver(false)
    setDropRel('')
    if (!canWrite || dropping) return
    const files = filesFromDataTransfer(e.dataTransfer).filter((f) => f.size > 0 || f.name)
    if (!files.length) return
    setDropping(true)
    try {
      await copyFilesInto(target, files)
    } finally {
      setDropping(false)
    }
  }

  const activeRel = file?.name ?? opening
  const fileName = activeRel ? (activeRel.split('/').pop() ?? activeRel) : null
  const canToggleSource =
    !!file && (file.kind === 'html' || file.kind === 'markdown' || file.kind === 'molecule')
  const showingCode =
    !!file &&
    (file.kind === 'text' ||
      ((file.kind === 'html' || file.kind === 'markdown' || file.kind === 'molecule') &&
        viewMode === 'source'))
  const root = cache['']
  const dropHintDir = dropRel || '根目录'
  const showPreview = !!file || !!opening

  const fileView = (() => {
    if (opening && !file) {
      return <div className="file-view file-view-loading file-view-fade">加载预览…</div>
    }
    if (!file) return null
    if (file.kind === 'image') {
      return (
        <div className="file-view file-view-image file-view-fade">
          <img src={file.dataUrl} alt={fileName ?? ''} />
        </div>
      )
    }
    if (file.kind === 'pdf') {
      return (
        <iframe
          className="file-view file-view-pdf file-view-fade"
          title={fileName ?? 'pdf'}
          src={file.dataUrl}
        />
      )
    }
    if (file.kind === 'html' && viewMode === 'preview') {
      return (
        <iframe
          className="file-view file-view-html file-view-fade"
          title={fileName ?? 'html'}
          sandbox={HTML_PREVIEW_SANDBOX}
          srcDoc={htmlWithBase(file.content, file.baseHref)}
        />
      )
    }
    if (file.kind === 'markdown' && viewMode === 'preview') {
      return (
        <div className="file-view file-view-md file-view-fade md">
          <Markdown remarkPlugins={[remarkGfm]}>{file.content}</Markdown>
        </div>
      )
    }
    if (file.kind === 'molecule' && viewMode === 'preview') {
      return (
        <div className="file-view-fade">
          <MoleculeViewer content={file.content} format={file.format} />
        </div>
      )
    }
    if (file.kind === 'unavailable') {
      return (
        <div className="file-view file-view-meta file-view-empty file-view-fade">
          <p className="file-view-empty-title">无法预览这种文件</p>
          <p className="file-view-empty-desc">
            暂不支持这种文件的格式、编码或大小。请使用其他应用打开。
          </p>
        </div>
      )
    }
    if ('content' in file) {
      return <CodePreview content={file.content} filename={file.name} wrap={wrap} />
    }
    return null
  })()

  return (
    <div className="project-files">
      <div
        className={`project-files-body${dragOver ? ' is-dragover' : ''}${dropping ? ' is-dropping' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={(e) => void onDrop(e)}
      >
        <div className="files-toolbar">
          <div className="crumbs">
            {showPreview ? (
              <>
                <button className="crumb-back" onClick={closeFile} title="返回文件树">
                  <ArrowLeft className="ic ic-sm" />
                </button>
                <span className="crumb crumb-tab current">{fileName}</span>
              </>
            ) : selectedDir === '' ? (
              <span className="crumb crumb-tab current" title={workdir}>
                项目根目录
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="crumb crumb-tab"
                  title={workdir}
                  onClick={() => {
                    setSelectedDir('')
                    setOpenMenuOpen(false)
                    setOpenMenuErr('')
                  }}
                >
                  项目根目录
                </button>
                <span className="crumb-sep" aria-hidden>
                  /
                </span>
                <span
                  className="crumb crumb-tab current"
                  title={selectedDir}
                >
                  {selectedDir.split('/').pop() ?? selectedDir}
                </span>
              </>
            )}
          </div>
          {canOpenMenu || showingCode || canToggleSource ? (
          <div className="file-view-tabs" role="group" aria-label="预览工具">
            {showingCode ? (
              <button
                type="button"
                className={`fvt fvt-icon${wrap ? ' on' : ''}`}
                title={wrap ? '取消折行' : '自动折行'}
                aria-label={wrap ? '取消折行' : '自动折行'}
                aria-pressed={wrap}
                onClick={() => setWrap((v) => !v)}
              >
                <WrapText className="ic ic-sm" />
              </button>
            ) : null}
            {canToggleSource ? (
              <>
                <button
                  type="button"
                  className={`fvt fvt-icon${viewMode === 'preview' ? ' on' : ''}`}
                  title="预览"
                  aria-label="预览"
                  aria-pressed={viewMode === 'preview'}
                  onClick={() => setViewMode('preview')}
                >
                  <Eye className="ic ic-sm" />
                </button>
                <button
                  type="button"
                  className={`fvt fvt-icon${viewMode === 'source' ? ' on' : ''}`}
                  title="源码"
                  aria-label="源码"
                  aria-pressed={viewMode === 'source'}
                  onClick={() => setViewMode('source')}
                >
                  <Code2 className="ic ic-sm" />
                </button>
              </>
            ) : null}
            {canOpenMenu ? (
              <div className={`open-with${openMenuOpen ? ' open' : ''}`} ref={openMenuRef}>
                <button
                  type="button"
                  className="open-with-trigger"
                  title="打开方式"
                  aria-label="打开方式"
                  aria-expanded={openMenuOpen}
                  disabled={openMenuBusy && !openMenuOpen}
                  onClick={toggleOpenMenu}
                >
                  {openApps.find((a) => a.isDefault)?.iconDataUrl ? (
                    <img
                      className="open-with-icon"
                      src={openApps.find((a) => a.isDefault)!.iconDataUrl}
                      alt=""
                    />
                  ) : (
                    <FolderOpen className="ic ic-sm" />
                  )}
                  <span className="open-with-divider" aria-hidden />
                  <ChevronDown className="ic ic-sm open-with-caret" />
                </button>
                {openMenuOpen && (
                  <div className="open-with-menu" role="menu">
                    {openMenuBusy && !openApps.length ? (
                      <div className="open-with-empty">加载中…</div>
                    ) : (
                      <>
                        {openApps.map((a) => (
                          <button
                            key={a.id || a.name}
                            type="button"
                            className="open-with-item"
                            role="menuitem"
                            disabled={openMenuBusy}
                            onClick={() => void runOpenAction('app', a.path || undefined)}
                          >
                            {a.iconDataUrl ? (
                              <img className="open-with-icon" src={a.iconDataUrl} alt="" />
                            ) : (
                              <span className="open-with-icon-fallback" />
                            )}
                            <span className="open-with-label">{a.name}</span>
                            {a.isDefault ? <Check className="ic ic-sm open-with-check" /> : null}
                          </button>
                        ))}
                        {openApps.length ? <div className="open-with-sep" role="separator" /> : null}
                        {!isRemote ? (
                          <button
                            type="button"
                            className="open-with-item"
                            role="menuitem"
                            disabled={openMenuBusy}
                            onClick={() => void runOpenAction('reveal')}
                          >
                            {systemIcons.reveal ? (
                              <img className="open-with-icon" src={systemIcons.reveal} alt="" />
                            ) : (
                              <Folder className="ic ic-sm" />
                            )}
                            <span className="open-with-label">
                              {/Mac|iPhone|iPod|iPad/i.test(navigator.platform) ||
                              navigator.userAgent.includes('Mac')
                                ? '在访达中显示'
                                : '在文件夹中显示'}
                            </span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="open-with-item"
                          role="menuitem"
                          disabled={openMenuBusy}
                          onClick={() => void runOpenAction('terminal')}
                        >
                          {systemIcons.terminal ? (
                            <img className="open-with-icon" src={systemIcons.terminal} alt="" />
                          ) : (
                            <Terminal className="ic ic-sm" />
                          )}
                          <span className="open-with-label">在终端中打开目录</span>
                        </button>
                      </>
                    )}
                    {openMenuErr ? <div className="open-with-err">{openMenuErr}</div> : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          ) : null}
        </div>

        {dragOver || dropping ? (
          <div className="files-drop-hint" aria-live="polite">
            {dropping
              ? '正在复制…'
              : `松开以复制到 ${dropHintDir === '' ? '根目录' : dropHintDir}`}
          </div>
        ) : null}

        {error && <div className="files-note">{error}</div>}

        {showPreview ? (
          fileView
        ) : root === 'loading' || root === undefined ? (
          <div className="files-note">加载中…</div>
        ) : typeof root === 'string' ? (
          <div className="files-note">{root}</div>
        ) : (
          <div className="file-tree" role="tree">
            {root.length === 0 ? (
              <div className="files-note">空目录</div>
            ) : (
              root.map((e) => (
                <TreeNode
                  key={e.name}
                  entry={e}
                  parentRel=""
                  depth={0}
                  expanded={expanded}
                  cache={cache}
                  selectedDir={selectedDir}
                  dropRel={dragOver ? dropRel : null}
                  onToggle={toggleDir}
                  onOpenFile={openFile}
                  onDropTarget={setDropRel}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div className="sub-label project-files-foot">
        项目文件 <span style={{ fontWeight: 400 }}>· {workdir}</span>
      </div>
    </div>
  )
}

function TreeNode({
  entry,
  parentRel,
  depth,
  expanded,
  cache,
  selectedDir,
  dropRel,
  onToggle,
  onOpenFile,
  onDropTarget,
}: {
  entry: DirEntry
  parentRel: string
  depth: number
  expanded: Set<string>
  cache: DirCache
  selectedDir: string
  dropRel: string | null
  onToggle: (rel: string) => void
  onOpenFile: (rel: string) => void
  onDropTarget: (rel: string) => void
}) {
  const rel = joinRel(parentRel, entry.name)
  const open = entry.isDir && expanded.has(rel)
  const kids = entry.isDir ? cache[rel] : undefined
  const isDropTarget = dropRel !== null && dropRel === rel
  const isSelected = entry.isDir && selectedDir === rel

  return (
    <div className="ft-node" role="treeitem" aria-expanded={entry.isDir ? open : undefined}>
      <div
        className={`sfile ft-row${isDropTarget ? ' is-drop-target' : ''}${isSelected ? ' is-selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => (entry.isDir ? onToggle(rel) : onOpenFile(rel))}
        onDragEnter={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDropTarget(entry.isDir ? rel : parentRel)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDropTarget(entry.isDir ? rel : parentRel)
        }}
      >
        {entry.isDir ? (
          open ? (
            <ChevronDown className="ic ic-sm ft-chevron" />
          ) : (
            <ChevronRight className="ic ic-sm ft-chevron" />
          )
        ) : (
          <span className="ft-chevron-gap" />
        )}
        {entry.isDir ? (
          open ? (
            <FolderOpen className="ic ic-sm" />
          ) : (
            <Folder className="ic ic-sm" />
          )
        ) : (
          <FileIcon name={entry.name} />
        )}
        <span className="sf-name">{entry.name}</span>
        {!entry.isDir && <span className="sf-meta">{formatSize(entry.size)}</span>}
      </div>
      {open ? (
        <div className="ft-children" role="group">
          {kids === 'loading' || kids === undefined ? (
            <div className="ft-muted" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
              加载中…
            </div>
          ) : typeof kids === 'string' ? (
            <div className="ft-muted" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
              {kids}
            </div>
          ) : kids.length === 0 ? (
            <div className="ft-muted" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
              空目录
            </div>
          ) : (
            kids.map((child) => (
              <TreeNode
                key={child.name}
                entry={child}
                parentRel={rel}
                depth={depth + 1}
                expanded={expanded}
                cache={cache}
                selectedDir={selectedDir}
                dropRel={dropRel}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                onDropTarget={onDropTarget}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

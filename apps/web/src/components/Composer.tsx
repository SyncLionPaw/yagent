import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, ReactNode, RefObject } from 'react'
import {
  Command,
  CornerDownLeft,
  FilePen,
  Layers,
  // Mic, // 语音输入暂关
  Paperclip,
  ShieldAlert,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type { SendKey } from '@yagent/core'
import type { ApprovalMode } from '../approval'
import { acceptAttachReason, MAX_ATTACH_BYTES } from '../lib/attachAccept'
import { HTML_PREVIEW_SANDBOX } from '../lib/htmlPreview'
import { fileKindOf } from '../lib/utils'
import { filterSlashCommands, slashMenuQuery } from '../slashCommands'

import { AttachPreviewCard, type AttachVisual } from './AttachPreviewCard'
import { TextBlock } from './TextBlock'

export interface PendingAttachment {
  id: string
  name: string
  size: number
  file: File
}

/** 上下文占用条上的一段（颜色块） */
export interface ContextSegment {
  id: string
  label: string
  tokens: number
  /** CSS color */
  color: string
}

/** 上下文占用：空心圆环 + Cursor 风格悬停面板 */
export interface ContextMeter {
  /** 0–1+，超过 1 仍按满环着色告警 */
  ratio: number
  /** 窗口上限，用于分段条占比 */
  limit: number
  /** 面板标题旁的占比，如 37% */
  pctLabel: string
  /** 如 ~12.4k / 200k */
  tokensLabel: string
  segments: ContextSegment[]
  /** 非占用条信息：缓存命中、裁剪等 */
  notes?: { label: string; value: string }[]
}

interface ComposerProps {
  draft: string
  running: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  attachments: PendingAttachment[]
  approval?: ReactNode
  /** 工具审批档位：询问 / 写文件自动 / 全自动 */
  approvalMode: ApprovalMode
  /** Enter 发送 或 ⌘/Ctrl+Enter 发送；另一组换行 */
  sendKey?: SendKey
  /** SSH 等远程不可达：工具不全，输入框展示降级态 */
  toolsDegraded?: boolean
  /** 降级态短提示，如「远程离线 · host」 */
  toolsDegradedHint?: string
  /** 正在编辑某条已发送消息时展示横条 */
  editingMessage?: boolean
  /** ask_user_question 挂起：禁用停止，避免误点打断问答 */
  askingUser?: boolean
  /** 输入框左侧上下文占用环 */
  context?: ContextMeter | null
  /** 运行中已排队、待本轮结束后接跑的消息（展开可查看 / 移除） */
  queuedItems?: { text: string; hasImages: boolean; hasFiles: boolean }[]
  onRemoveQueued?: (index: number) => void
  onClearQueued?: () => void
  onDraftChange: (v: string) => void
  onAttachmentsChange: (files: PendingAttachment[]) => void
  onSend: () => void
  onStop: () => void
  /** 语音输入暂关 */
  onOpenVoice?: () => void
  onApprovalModeChange: (mode: ApprovalMode) => void
  onCancelEdit?: () => void
}

function isModEnter(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey
}

function modLabel(): string {
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac')
    ? '⌘'
    : 'Ctrl'
}

/** 从 DataTransfer 收集文件（粘贴 / 拖放）；纯文本返回空 */
export function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  const seen = new Set<string>()
  const push = (f: File | null) => {
    if (!f) return
    const key = `${f.name}:${f.size}:${f.type}:${f.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(f)
  }
  if (data.files?.length) {
    for (const f of Array.from(data.files)) push(f)
  }
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file') push(item.getAsFile())
    }
  }
  return out.map((f, i) => {
    if (f.name && f.name !== 'image.png') return f
    const ext = f.type === 'image/jpeg' ? 'jpg' : f.type === 'image/webp' ? 'webp' : 'png'
    return new File([f], `paste-${Date.now()}-${i}.${ext}`, { type: f.type || 'image/png' })
  })
}

export function Composer({
  draft,
  running,
  textareaRef,
  attachments,
  approval,
  approvalMode,
  sendKey = 'cmdEnter',
  toolsDegraded = false,
  toolsDegradedHint,
  editingMessage,
  askingUser,
  context,
  queuedItems = [],
  onRemoveQueued,
  onClearQueued,
  onDraftChange,
  onAttachmentsChange,
  onSend,
  onStop,
  // onOpenVoice, // 语音输入暂关
  onApprovalModeChange,
  onCancelEdit,
}: ComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null)
  const ta = textareaRef ?? localRef
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [attachHint, setAttachHint] = useState('')
  const [slashHi, setSlashHi] = useState(0)
  const [queueOpen, setQueueOpen] = useState(false)
  const queuedCount = queuedItems.length
  const enterToSend = sendKey === 'enter'
  const mod = modLabel()
  const sendShortcut = enterToSend ? 'Enter' : `${mod}+Enter`
  const newlineShortcut = enterToSend ? `${mod}+Enter` : 'Enter'

  const insertNewline = () => {
    const el = ta.current
    if (!el) {
      onDraftChange(draft + '\n')
      return
    }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + '\n' + draft.slice(end)
    onDraftChange(next)
    requestAnimationFrame(() => {
      const pos = start + 1
      el.selectionStart = el.selectionEnd = pos
    })
  }

  useEffect(() => {
    if (queuedCount === 0) setQueueOpen(false)
  }, [queuedCount])

  useEffect(() => {
    if (!queueOpen) return
    const close = () => setQueueOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [queueOpen])
  const slashPrefix = slashMenuQuery(draft)
  const slashHits = slashPrefix != null ? filterSlashCommands(slashPrefix) : []
  const slashOpen = !editingMessage && slashHits.length > 0

  // textarea 自适应高度：随内容长高，上限 180px（CSS max-height 控制内滚），发送后复位
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }, [draft, ta])

  useEffect(() => {
    if (!attachHint) return
    const t = setTimeout(() => setAttachHint(''), 2400)
    return () => clearTimeout(t)
  }, [attachHint])

  useEffect(() => {
    setSlashHi(0)
  }, [slashPrefix])

  const addFiles = (files: File[]) => {
    if (!files.length) return
    const next = [...attachments]
    let skippedType = 0
    let skippedSize = 0
    for (const file of files) {
      const reason = acceptAttachReason(file)
      if (reason === 'size') {
        skippedSize++
        continue
      }
      if (reason === 'type') {
        skippedType++
        continue
      }
      next.push({
        id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        file,
      })
    }
    if (next.length !== attachments.length) onAttachmentsChange(next)
    if (skippedSize) setAttachHint(`有文件超过 ${MAX_ATTACH_BYTES / 1024 / 1024}MB，已跳过`)
    else if (skippedType) setAttachHint('有文件类型不支持，已跳过')
  }

  const handlePaste = (e: ClipboardEvent) => {
    const files = filesFromDataTransfer(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    addFiles(files)
  }

  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const handleDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setDragging(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const handleDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    addFiles(filesFromDataTransfer(e.dataTransfer))
  }

  return (
    <div className="composer">
      <div className="composer-main">
        {approval}
        <div
          className={`composer-box${dragging ? ' drag-over' : ''}${running ? ' is-generating' : ''}${toolsDegraded ? ' is-tools-degraded' : ''}`}
          onPaste={handlePaste}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {toolsDegraded ? (
            <div className="composer-degraded-badge" title={toolsDegradedHint || '部分工具暂不可用'}>
              <ShieldAlert className="ic ic-sm" />
              <span>{toolsDegradedHint || '工具降级 · 远程能力暂不可用'}</span>
            </div>
          ) : null}
          {/* 浮在输入框上方：不占文档流，避免舞台白底拉出整条遮挡带 */}
          {attachments.length > 0 && (
            <div className="attach-list">
              {attachments.map((a) => (
                <AttachCard
                  key={a.id}
                  item={a}
                  onRemove={() => onAttachmentsChange(attachments.filter((x) => x.id !== a.id))}
                />
              ))}
            </div>
          )}
          {queuedCount > 0 && (
            <div className="composer-queue-wrap">
              <button
                type="button"
                className={`composer-queue${queueOpen ? ' open' : ''}`}
                title={`已排队 ${queuedCount} 条，点击查看`}
                aria-label={`已排队 ${queuedCount} 条消息`}
                aria-expanded={queueOpen}
                onClick={(e) => {
                  e.stopPropagation()
                  setQueueOpen((v) => !v)
                }}
              >
                <Layers className="ic" />
                <span className="composer-queue-n">{queuedCount}</span>
              </button>
              {queueOpen && (
                <div
                  className="composer-queue-pop"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="composer-queue-head">
                    <span>排队中 · 本轮结束后合并发送</span>
                    {onClearQueued && (
                      <button
                        type="button"
                        className="composer-queue-clear"
                        onClick={() => {
                          onClearQueued()
                          setQueueOpen(false)
                        }}
                      >
                        清空
                      </button>
                    )}
                  </div>
                  <ul className="composer-queue-list">
                    {queuedItems.map((item, i) => (
                      <li key={i} className="composer-queue-item">
                        <span className="composer-queue-idx">{i + 1}</span>
                        <span className="composer-queue-text">
                          {item.text.trim() ||
                            (item.hasImages || item.hasFiles ? '（附件）' : '（空）')}
                          {(item.hasImages || item.hasFiles) && (
                            <Paperclip className="ic ic-sm composer-queue-clip" />
                          )}
                        </span>
                        {onRemoveQueued && (
                          <button
                            type="button"
                            className="icon-btn composer-queue-rm"
                            title="移出队列"
                            onClick={() => onRemoveQueued(i)}
                          >
                            <Trash2 className="ic ic-sm" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {attachHint && <div className="attach-hint">{attachHint}</div>}
          {editingMessage && (
            <div className="composer-edit-bar">
              <span>正在编辑消息</span>
              <button
                type="button"
                className="icon-btn"
                title="取消编辑"
                onClick={onCancelEdit}
              >
                <X className="ic ic-sm" />
              </button>
            </div>
          )}

          {slashOpen && (
            <div className="slash-menu" role="listbox" aria-label="斜杠命令">
              {slashHits.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  role="option"
                  aria-selected={i === slashHi}
                  className={`slash-item${i === slashHi ? ' on' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onDraftChange(`/${c.name}`)
                    setSlashHi(i)
                  }}
                >
                  <code className="slash-name">/{c.name}</code>
                  <span className="slash-desc">{c.description}</span>
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={ta}
            placeholder={
              editingMessage
                ? '编辑后发送，将从此处分叉重跑…'
                : running
                  ? `继续输入，${sendShortcut} 排队，本轮结束后合并发送…`
                  : enterToSend
                    ? `继续指示，Enter 发送；${newlineShortcut} 或 Shift+Enter 换行；输入 / 可用命令…`
                    : `继续指示，${sendShortcut} 发送；${newlineShortcut} 换行；输入 / 可用命令…`
            }
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // 输入法组词期间的 Enter 是确认候选，不触发发送
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
              if (e.key === 'Escape' && editingMessage) {
                e.preventDefault()
                onCancelEdit?.()
                return
              }
              if (slashOpen) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSlashHi((h) => (h + 1) % slashHits.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSlashHi((h) => (h - 1 + slashHits.length) % slashHits.length)
                  return
                }
                // Enter / ⌘Enter / Tab：只补全进输入框，不发送（避免误发）
                if (e.key === 'Tab' || e.key === 'Enter') {
                  e.preventDefault()
                  const pick = slashHits[slashHi] ?? slashHits[0]
                  if (pick) onDraftChange(`/${pick.name}`)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  onDraftChange('')
                  return
                }
              }
              // 输入为空时 Backspace 删掉最后一个待发送附件
              if (
                e.key === 'Backspace' &&
                !draft &&
                attachments.length > 0 &&
                (e.currentTarget.selectionStart ?? 0) === 0 &&
                (e.currentTarget.selectionEnd ?? 0) === 0
              ) {
                e.preventDefault()
                onAttachmentsChange(attachments.slice(0, -1))
                return
              }
              if (e.key !== 'Enter') return
              const modPressed = isModEnter(e)
              if (enterToSend) {
                if (modPressed) {
                  e.preventDefault()
                  insertNewline()
                } else if (!e.shiftKey) {
                  e.preventDefault()
                  onSend()
                }
                return
              }
              // cmdEnter：⌘/Ctrl+Enter 发送，Enter 换行
              if (modPressed) {
                e.preventDefault()
                onSend()
              }
            }}
          />

          <div className="composer-bar">
            <ApprovalModeSwitch value={approvalMode} onChange={onApprovalModeChange} />
            {/* 语音输入暂关
            <button className="chip mic-chip" title="语音输入" onClick={onOpenVoice}>
              <Mic className="ic ic-sm" />
            </button>
            */}
            <ContextRing meter={context ?? null} />
            {running ? (
              <button
                className={`send stop${askingUser ? ' is-locked' : ''}`}
                title={askingUser ? '请先回答上方问题（或点跳过）' : '停止生成'}
                aria-label={askingUser ? '问答中，停止已禁用' : '停止生成'}
                disabled={!!askingUser}
                onClick={onStop}
              >
                <span className="ring" />
              </button>
            ) : (
              <button className="send" title={`发送 (${sendShortcut})`} onClick={onSend}>
                {enterToSend ? (
                  <CornerDownLeft className="ic send-ic" />
                ) : mod === '⌘' ? (
                  <>
                    <Command className="ic send-ic" />
                    <span className="send-plus">+</span>
                    <CornerDownLeft className="ic send-ic" />
                  </>
                ) : (
                  <>
                    <span className="send-mod-label">Ctrl</span>
                    <span className="send-plus">+</span>
                    <CornerDownLeft className="ic send-ic" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const RING_R = 8
const RING_C = 2 * Math.PI * RING_R

function ContextRing({ meter }: { meter: ContextMeter | null }) {
  const ratio = Math.max(0, meter?.ratio ?? 0)
  const capped = Math.min(1, ratio)
  const level = ratio >= 0.9 ? 'high' : ratio >= 0.7 ? 'mid' : 'ok'
  const segments = meter?.segments ?? []
  const limit = Math.max(1, meter?.limit ?? 1)
  const aria =
    meter != null
      ? `上下文占用 ${meter.pctLabel}，${meter.tokensLabel}`
      : '上下文占用'
  return (
    <span
      className={`context-ring level-${level}`}
      aria-label={aria}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(capped * 100)}
    >
      <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden>
        <circle className="context-ring-track" cx="11" cy="11" r={RING_R} />
        <circle
          className="context-ring-fill"
          cx="11"
          cy="11"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - capped)}
          transform="rotate(-90 11 11)"
        />
      </svg>
      {meter && (
        <span className="context-ring-pop" role="tooltip">
          <span className="ctx-pop-head">
            <span className="ctx-pop-title">上下文占用</span>
          </span>
          <span className="ctx-pop-summary">
            <span>{meter.pctLabel} 已用</span>
            <span>{meter.tokensLabel}</span>
          </span>
          <span className="ctx-pop-bar" aria-hidden>
            {segments.map((seg) => {
              const w = (seg.tokens / limit) * 100
              if (w <= 0) return null
              return (
                <span
                  key={seg.id}
                  className="ctx-pop-seg"
                  style={{ width: `${Math.min(w, 100)}%`, background: seg.color }}
                />
              )
            })}
          </span>
          <span className="ctx-pop-list">
            {segments.map((seg) => (
              <span key={seg.id} className="ctx-pop-row">
                <span className="ctx-pop-dot" style={{ background: seg.color }} />
                <span className="ctx-pop-k">{seg.label}</span>
                <span className="ctx-pop-v">{formatContextTok(seg.tokens)}</span>
              </span>
            ))}
          </span>
          {meter.notes && meter.notes.length > 0 && (
            <span className="ctx-pop-notes">
              {meter.notes.map((n) => (
                <span key={n.label} className="ctx-pop-row">
                  <span className="ctx-pop-k">{n.label}</span>
                  <span className="ctx-pop-v">{n.value}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

function formatContextTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(Math.round(n))
}

const APPROVAL_OPTS: {
  id: ApprovalMode
  title: string
  Icon: typeof ShieldAlert
}[] = [
  { id: 'ask', title: '询问：写文件与跑命令都需确认', Icon: ShieldAlert },
  { id: 'files', title: '写文件自动执行，跑命令仍需确认', Icon: FilePen },
  { id: 'all', title: '全自动：写文件与跑命令都不再询问', Icon: Zap },
]

function ApprovalModeSwitch({
  value,
  onChange,
}: {
  value: ApprovalMode
  onChange: (m: ApprovalMode) => void
}) {
  return (
    <div className="approval-switch" role="radiogroup" aria-label="工具审批">
      {APPROVAL_OPTS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`approval-switch-opt${value === o.id ? ' on' : ''}`}
          data-tip={o.title}
          aria-label={o.title}
          onClick={() => onChange(o.id)}
        >
          <o.Icon className="ic ic-sm" />
        </button>
      ))}
    </div>
  )
}

/** 待发送附件卡：与气泡旁共用；点击也可预览（图 / HTML / MD / PDF） */
function AttachCard({ item, onRemove }: { item: PendingAttachment; onRemove: () => void }) {
  const kind = fileKindOf(item.name)
  const [visual, setVisual] = useState<AttachVisual>({ type: 'cover' })
  const [peek, setPeek] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const name = item.name.toLowerCase()
    const isImage = kind === 'image' || item.file.type.startsWith('image/')

    void (async () => {
      try {
        if (isImage) {
          objectUrl = URL.createObjectURL(item.file)
          if (!cancelled) setVisual({ type: 'image', url: objectUrl })
          return
        }
        if (/\.html?$/.test(name) || item.file.type === 'text/html') {
          const html = (await item.file.text()).slice(0, 80_000)
          if (!cancelled) setVisual({ type: 'html', html })
          return
        }
        if (/\.(md|markdown)$/.test(name) || item.file.type === 'text/markdown') {
          const text = (await item.file.text()).slice(0, 12_000)
          if (!cancelled) setVisual({ type: 'md', text })
          return
        }
        if (/\.pdf$/.test(name) || item.file.type === 'application/pdf') {
          objectUrl = URL.createObjectURL(item.file)
          if (!cancelled) setVisual({ type: 'pdf', url: objectUrl })
          return
        }
        if (!cancelled) setVisual({ type: 'cover' })
      } catch {
        if (!cancelled) setVisual({ type: 'cover' })
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.file, item.name, kind])

  const canPeek = visual.type !== 'cover'

  return (
    <>
      <AttachPreviewCard
        name={item.name}
        size={item.size}
        visual={visual}
        title={canPeek ? `${item.name} · 点击预览` : undefined}
        onRemove={onRemove}
        onClick={canPeek ? () => setPeek(true) : undefined}
      />
      {peek && visual.type === 'image' && (
        <ComposerPeek
          name={item.name}
          onClose={() => setPeek(false)}
          body={<img className="doc-lightbox-frame" style={{ objectFit: 'contain' }} src={visual.url} alt={item.name} />}
        />
      )}
      {peek && visual.type === 'html' && (
        <ComposerPeek
          name={item.name}
          onClose={() => setPeek(false)}
          body={
            <iframe
              className="doc-lightbox-frame"
              title={item.name}
              sandbox={HTML_PREVIEW_SANDBOX}
              srcDoc={visual.html}
            />
          }
        />
      )}
      {peek && visual.type === 'md' && (
        <ComposerPeek
          name={item.name}
          onClose={() => setPeek(false)}
          body={
            <div className="doc-lightbox-md">
              <TextBlock text={visual.text} />
            </div>
          }
        />
      )}
      {peek && visual.type === 'pdf' && (
        <ComposerPeek
          name={item.name}
          onClose={() => setPeek(false)}
          body={<iframe className="doc-lightbox-frame" title={item.name} src={visual.url} />}
        />
      )}
    </>
  )
}

function ComposerPeek({
  name,
  body,
  onClose,
}: {
  name: string
  body: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="img-lightbox doc-lightbox" role="dialog" aria-modal="true" aria-label={name}>
      <div className="img-lightbox-bar">
        <span className="img-lightbox-cap">{name}</span>
        <button type="button" className="icon-btn img-lb-btn" title="关闭 (Esc)" onClick={onClose}>
          <X className="ic ic-sm" />
        </button>
      </div>
      <div className="doc-lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="doc-lightbox-panel" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    </div>
  )
}

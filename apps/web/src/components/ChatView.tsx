import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FoldVertical,
  Minus,
  Plus,
  RotateCcw,
  UnfoldVertical,
  X,
} from 'lucide-react'
import type { Block, Conversation, ConversationNode, Ref } from '@yagent/core'
import { HTML_PREVIEW_SANDBOX } from '../lib/htmlPreview'
import { formatMsgTime, pathToActive } from '../lib/utils'
import { TextBlock } from './TextBlock'
import { ThoughtBlock } from './ThoughtBlock'
import { ToolCard } from './ToolCard'
import { ArtifactBlock } from './ArtifactBlock'
import { AttachPreviewCard, type AttachVisual } from './AttachPreviewCard'
import { EmptyChatHero } from './YParticleLogo'

function isProcessBlock(b: Block): boolean {
  return b.type === 'thinking' || b.type === 'tool'
}

function processSummary(blocks: Block[]): string {
  const thoughts = blocks.filter((b) => b.type === 'thinking')
  const tools = blocks.filter((b) => b.type === 'tool')
  const parts: string[] = []
  if (thoughts.length) parts.push(`${thoughts.length} 次思考`)
  if (tools.length) parts.push(`${tools.length} 次工具`)
  const ms = thoughts.reduce((n, b) => n + (b.type === 'thinking' ? (b.durationMs ?? 0) : 0), 0)
  if (ms > 0) parts.push(`${(ms / 1000).toFixed(1)}s`)
  return parts.join(' · ') || '过程'
}

interface ChatViewProps {
  conversation: Conversation
  onRefClick: (id: number) => void
  onToggleFiles: () => void
  /** 当前正在主输入区编辑的用户节点；用于高亮原气泡 */
  editingNodeId?: string | null
  /** 点击用户气泡 → 拉到主输入区编辑；流式中不提供 */
  onStartEditUserMessage?: (nodeId: string, text: string) => void
}

type MinimapTurn = { id: string; tip: string }

function collectMinimapTurns(path: ConversationNode[]): MinimapTurn[] {
  const turns: MinimapTurn[] = []
  for (const node of path) {
    if (node.role === 'round') {
      const raw = node.blocks[0]?.type === 'text' ? node.blocks[0].text : ''
      const tip = visibleUserText(raw).replace(/\s+/g, ' ').trim()
      const hasAttach = node.blocks.some((b) => b.type === 'image' || b.type === 'file')
      if (!tip && !hasAttach) continue
      turns.push({ id: node.id, tip: tip || '（附件）' })
    } else if (node.role === 'user') {
      const texts = node.blocks.filter((b) => b.type === 'text')
      if (texts.length === 0) continue
      const tip = texts
        .map((b) => (b.type === 'text' ? visibleUserText(b.text) : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!tip) continue
      turns.push({ id: node.id, tip })
    }
  }
  return turns
}

/** 对话区：渲染当前会话从根到 activeNodeId 的路径 */
export function ChatView({
  conversation,
  onRefClick,
  onToggleFiles,
  editingNodeId,
  onStartEditUserMessage,
}: ChatViewProps) {
  const chatRef = useRef<HTMLDivElement>(null)
  const path = pathToActive(conversation.nodes, conversation.activeNodeId)
  const last = path[path.length - 1]
  const canEdit = conversation.status !== 'running' && !!onStartEditUserMessage
  const pathKey = path.map((n) => n.id).join('|')
  const turns = useMemo(() => collectMinimapTurns(path), [pathKey, conversation.nodes])
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const jumpingRef = useRef(false)

  // 新消息 / 流式更新时滚到底部（text/thinking 长度变化也算更新）
  const lastBlockCount = last?.blocks.length ?? 0
  const lastBlockKey = JSON.stringify(
    last?.blocks.map((b) => b.type + ('status' in b ? b.status : '')) ?? [],
  )
  const lastTextLen =
    last?.blocks.reduce(
      (n, b) => n + (b.type === 'text' || b.type === 'thinking' ? b.text.length : 0),
      0,
    ) ?? 0
  useEffect(() => {
    if (jumpingRef.current) return
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation.id, conversation.activeNodeId, lastBlockCount, lastBlockKey, lastTextLen])

  // 滚动时高亮当前视口对应的提问条
  useEffect(() => {
    const root = chatRef.current
    if (!root || turns.length === 0) {
      setActiveTurnId(null)
      return
    }
    const sync = () => {
      const marker = root.getBoundingClientRect().top + Math.min(120, root.clientHeight * 0.25)
      let current = turns[0].id
      for (const t of turns) {
        const el = root.querySelector<HTMLElement>(`[data-turn="${t.id}"]`)
        if (!el) continue
        if (el.getBoundingClientRect().top <= marker) current = t.id
      }
      setActiveTurnId(current)
    }
    sync()
    root.addEventListener('scroll', sync, { passive: true })
    return () => root.removeEventListener('scroll', sync)
  }, [turns, conversation.id, lastBlockCount, lastTextLen])

  const jumpToTurn = (id: string) => {
    const root = chatRef.current
    const el = root?.querySelector<HTMLElement>(`[data-turn="${id}"]`)
    if (!root || !el) return
    jumpingRef.current = true
    setActiveTurnId(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => {
      jumpingRef.current = false
    }, 600)
  }

  return (
    <div className="chat-shell">
      {turns.length >= 2 && (
        <ConversationMinimap turns={turns} activeId={activeTurnId} onJump={jumpToTurn} />
      )}
      <div className={`chat${path.length === 0 ? ' is-empty' : ''}`} ref={chatRef}>
        {path.length === 0 ? (
          <EmptyChatHero />
        ) : (
          <>
            {path.map((node, i) => (
              <Message
                key={node.id}
                node={node}
                refs={conversation.refs}
                streaming={i === path.length - 1 && conversation.status === 'running'}
                canEdit={canEdit}
                editing={editingNodeId === node.id}
                onStartEditUserMessage={onStartEditUserMessage}
                onRefClick={onRefClick}
                onToggleFiles={onToggleFiles}
              />
            ))}
            {conversation.status === 'waiting' && (
              <div className="msg msg-agent">
                <div className="wait-bar">
                  <span className="dot dot-wait"></span>等待你的确认后继续在沙箱中验证
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** 左侧提问导航：每条用户提问一格，点击跳转 */
function ConversationMinimap({
  turns,
  activeId,
  onJump,
}: {
  turns: MinimapTurn[]
  activeId: string | null
  onJump: (id: string) => void
}) {
  return (
    <nav className="chat-minimap" aria-label="提问导航">
      {turns.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className={`chat-minimap-tick${activeId === t.id ? ' on' : ''}`}
          title={`${i + 1}. ${t.tip.slice(0, 80)}${t.tip.length > 80 ? '…' : ''}`}
          aria-label={`跳到第 ${i + 1} 问`}
          aria-current={activeId === t.id ? 'true' : undefined}
          onClick={() => onJump(t.id)}
        />
      ))}
    </nav>
  )
}

function Message({
  node,
  refs,
  streaming,
  canEdit,
  editing,
  onStartEditUserMessage,
  onRefClick,
  onToggleFiles,
}: {
  node: ConversationNode
  refs: Ref[]
  streaming: boolean
  canEdit: boolean
  editing: boolean
  onStartEditUserMessage?: (nodeId: string, text: string) => void
  onRefClick: (id: number) => void
  onToggleFiles: () => void
}) {
  const time = formatMsgTime(node.createdAt)

  // round 节点：一次完整问答（blocks[0] 是用户输入，随后可有用户图片，再是思考/工具/回答）
  if (node.role === 'round') {
    const rawText = node.blocks[0]?.type === 'text' ? node.blocks[0].text : ''
    const userText = visibleUserText(rawText)
    const userImages: { mime: string; name: string; data: string; path?: string }[] = []
    const userFiles: {
      name: string
      size: number
      path?: string
      preview?:
        | { kind: 'html'; html: string }
        | { kind: 'md'; text: string }
        | { kind: 'pdf'; dataUrl: string }
    }[] = []
    let i = 1
    while (i < node.blocks.length) {
      const b = node.blocks[i]
      if (b.type === 'image') userImages.push(b)
      else if (b.type === 'file') userFiles.push(b)
      else break
      i++
    }
    const rest = node.blocks.slice(i)
    return (
      <div className="msg msg-round" data-turn={node.id}>
        <div className="msg-user">
          <div className="msg-head">
            <span>{time}</span>
            <span className="who-user">你</span>
          </div>
          <div className="inner">
            {(userImages.length > 0 || userFiles.length > 0) && (
              <AttachStrip images={userImages} files={userFiles} />
            )}
            {userText ? (
              <UserBubble
                text={userText}
                editable={canEdit}
                editing={editing}
                onEdit={() => onStartEditUserMessage?.(node.id, userText)}
              />
            ) : null}
          </div>
        </div>
        <AgentReply
          blocks={rest}
          refs={refs}
          streaming={streaming}
          node={node}
          onRefClick={onRefClick}
          onToggleFiles={onToggleFiles}
        />
      </div>
    )
  }

  if (node.role === 'user') {
    const texts = node.blocks.filter((b) => b.type === 'text')
    const results = node.blocks.filter((b) => b.type === 'tool_result')
    // 纯工具结果节点不渲染：模型协议要求它存为 user 角色，但输出已由 ToolCard 的 detail 展示，
    // 再渲染一行就是重复内容
    if (texts.length === 0 && results.length > 0) return null
    return (
      <div className="msg msg-user" data-turn={node.id}>
        <div className="msg-head">
          <span>{time}</span>
          <span className="who-user">你</span>
        </div>
        {texts.map((b, i) => {
          const t = b.type === 'text' ? visibleUserText(b.text) : ''
          return (
            <div className="inner" key={i}>
              <UserBubble
                text={t}
                editable={canEdit && i === 0}
                editing={editing && i === 0}
                onEdit={() => onStartEditUserMessage?.(node.id, t)}
              />
            </div>
          )
        })}
        {results.map((b, i) =>
          b.type === 'tool_result' ? (
            <ToolResultLine key={i} tool={b.tool} content={b.content} isError={b.isError} />
          ) : null,
        )}
      </div>
    )
  }

  return (
    <div className="msg">
      <AgentReply
        blocks={node.blocks}
        refs={refs}
        streaming={streaming}
        node={node}
        time={time}
        onRefClick={onRefClick}
        onToggleFiles={onToggleFiles}
      />
    </div>
  )
}

/** agent 回复：右上角可一键折叠思考/工具过程为单行摘要 */
function AgentReply({
  blocks,
  refs,
  streaming,
  node,
  time,
  onRefClick,
  onToggleFiles,
}: {
  blocks: Block[]
  refs: Ref[]
  streaming: boolean
  node: ConversationNode
  time?: string
  onRefClick: (id: number) => void
  onToggleFiles: () => void
}) {
  const process = blocks.filter(isProcessBlock)
  const hasProcess = process.length > 0
  const [open, setOpen] = useState(false)

  return (
    <div className="msg-agent">
      <div className="msg-head">
        <span className="who-agent">yagent</span>
        {time && <span>{time}</span>}
        {hasProcess && (
          <button
            type="button"
            className="process-toggle"
            title={open ? '折叠思考与工具' : '展开思考与工具'}
            aria-label={open ? '折叠思考与工具' : '展开思考与工具'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronsDownUp className="ic ic-sm" /> : <ChevronsUpDown className="ic ic-sm" />}
          </button>
        )}
      </div>

      {streaming && blocks.length === 0 && (
        <div className="thinking">
          <span className="ring"></span>正在思考
        </div>
      )}

      {hasProcess && !open && (
        <button type="button" className="process-summary" onClick={() => setOpen(true)}>
          {processSummary(process)}
        </button>
      )}

      {blocks.map((block, i) => {
        if (!open && isProcessBlock(block)) return null
        return renderAgentBlock(block, i, node, refs, onRefClick, onToggleFiles)
      })}

      {blocks.length > 0 && <MessageActions node={node} />}
    </div>
  )
}

/** agent 侧块渲染（round 节点的 slice(1) 与旧版 agent 节点共用）；tool_result 不渲染（输出已在 ToolCard） */
function renderAgentBlock(
  block: ConversationNode['blocks'][number],
  i: number,
  node: ConversationNode,
  refs: Ref[],
  onRefClick: (id: number) => void,
  onToggleFiles: () => void,
) {
  switch (block.type) {
    case 'text':
      return <TextBlock key={i} text={block.text} refs={refs} onRefClick={onRefClick} />
    case 'thinking':
      return (
        <ThoughtBlock
          key={i}
          text={block.text}
          status={block.status}
          durationMs={block.durationMs}
        />
      )
    case 'tool':
      return (
        <ToolCard
          key={i}
          tool={block.tool}
          summary={block.summary}
          status={block.status}
          detail={block.detail}
          stats={block.stats}
        />
      )
    case 'tool_result':
    case 'image':
    case 'file':
      return null
    case 'artifacts':
      return (
        <ArtifactBlock
          key={i}
          items={block.items}
          durationMs={node.durationMs}
          onToggleFiles={onToggleFiles}
        />
      )
  }
}

/** AI 回复底部操作排：复制全文 */
function MessageActions({ node }: { node: ConversationNode }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    const text = node.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 剪贴板不可用时仍给出视觉反馈
    }
    setCopied(true)
  }

  return (
    <div className="msg-actions">
      <button
        className={`icon-btn${copied ? ' copied' : ''}`}
        title="复制"
        onClick={copy}
      >
        {copied ? <Check className="ic ic-sm" /> : <Copy className="ic ic-sm" />}
      </button>
    </div>
  )
}

/** 气泡只显示用户原文：去掉模型附注分隔之后，以及旧版直接塞进正文的 [附件:…] 行 */
function visibleUserText(raw: string): string {
  let s = raw
  const zw = s.indexOf('\u200c')
  if (zw >= 0) s = s.slice(0, zw)
  // 兼容案例：整段 [附件: name · 图片 · …] 曾直接拼进气泡
  s = s.replace(/(?:\n|^)\[附件:[^\]]*\](?:\n```[\s\S]*?```)?/g, '')
  return s.trimEnd()
}

const USER_BUBBLE_COLLAPSE_LINES = 5

/** 用户气泡：超 5 行默认折叠；点击气泡拉到主输入区编辑 */
function UserBubble({
  text,
  editable,
  editing,
  onEdit,
}: {
  text: string
  editable: boolean
  editing: boolean
  onEdit: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [collapsible, setCollapsible] = useState(false)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight)
    const line = Number.isFinite(lh) && lh > 0 ? lh : 21
    const limit = line * USER_BUBBLE_COLLAPSE_LINES
    // 展开时比完整高度；折叠时比 client（被 max-height 裁切）
    const full = el.scrollHeight
    setCollapsible(full > limit + 2)
  }, [text, expanded])

  // 换了一条消息时收起
  useEffect(() => {
    setExpanded(false)
  }, [text])

  if (!text) return null

  const collapsed = collapsible && !expanded

  return (
    <div
      className={`bubble${editable ? ' bubble-editable' : ''}${editing ? ' is-editing' : ''}${collapsed ? ' is-collapsed' : ''}${collapsible ? ' has-fold' : ''}`}
      title={editable ? '点击到输入框编辑' : undefined}
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={() => {
        if (editable) onEdit()
      }}
      onKeyDown={(e) => {
        if (!editable) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
    >
      <div ref={bodyRef} className="bubble-body">
        {text}
      </div>
      {collapsible && (
        <button
          type="button"
          className="bubble-fold-btn"
          title={expanded ? '收起' : '展开'}
          aria-label={expanded ? '收起' : '展开'}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          {expanded ? (
            <FoldVertical className="ic ic-sm" />
          ) : (
            <UnfoldVertical className="ic ic-sm" />
          )}
        </button>
      )}
    </div>
  )
}

type FilePreviewOpen =
  | { kind: 'image'; src: string; name: string }
  | { kind: 'html'; html: string; name: string }
  | { kind: 'md'; text: string; name: string }
  | { kind: 'pdf'; url: string; name: string }
  | { kind: 'meta'; name: string; size: number; path?: string }

/** 气泡外附件条：与发送区同一套 attach-card；均可点击预览 */
function AttachStrip({
  images,
  files,
}: {
  images: { mime: string; name: string; data: string; path?: string }[]
  files: {
    name: string
    size: number
    path?: string
    preview?:
      | { kind: 'html'; html: string }
      | { kind: 'md'; text: string }
      | { kind: 'pdf'; dataUrl: string }
  }[]
}) {
  const [open, setOpen] = useState<FilePreviewOpen | null>(null)

  return (
    <>
      <div className="msg-attach-strip">
        {images.map((img, idx) => {
          const src = `data:${img.mime};base64,${img.data}`
          return (
            <AttachPreviewCard
              key={`img-${img.name}-${idx}`}
              name={img.name}
              size={Math.round((img.data.length * 3) / 4)}
              visual={{ type: 'image', url: src }}
              title={`${img.name} · 点击预览`}
              onClick={() => setOpen({ kind: 'image', src, name: img.name })}
            />
          )
        })}
        {files.map((f, idx) => {
          let visual: AttachVisual = { type: 'cover' }
          if (f.preview?.kind === 'html') visual = { type: 'html', html: f.preview.html }
          else if (f.preview?.kind === 'md') visual = { type: 'md', text: f.preview.text }
          else if (f.preview?.kind === 'pdf') visual = { type: 'pdf', url: f.preview.dataUrl }
          const openPreview = (): void => {
            if (f.preview?.kind === 'html') setOpen({ kind: 'html', html: f.preview.html, name: f.name })
            else if (f.preview?.kind === 'md') setOpen({ kind: 'md', text: f.preview.text, name: f.name })
            else if (f.preview?.kind === 'pdf') setOpen({ kind: 'pdf', url: f.preview.dataUrl, name: f.name })
            else setOpen({ kind: 'meta', name: f.name, size: f.size, path: f.path })
          }
          return (
            <AttachPreviewCard
              key={`file-${f.name}-${idx}`}
              name={f.name}
              size={f.size}
              visual={visual}
              title={`${f.name} · 点击预览`}
              onClick={openPreview}
            />
          )
        })}
      </div>
      {open?.kind === 'image' && (
        <ImageLightbox src={open.src} name={open.name} onClose={() => setOpen(null)} />
      )}
      {open && open.kind !== 'image' && (
        <DocLightbox preview={open} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

/** HTML / MD / PDF / 无缩略内容时的元信息预览 */
function DocLightbox({
  preview,
  onClose,
}: {
  preview: Exclude<FilePreviewOpen, { kind: 'image' }>
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
    <div className="img-lightbox doc-lightbox" role="dialog" aria-modal="true" aria-label={preview.name}>
      <div className="img-lightbox-bar">
        <span className="img-lightbox-cap">{preview.name}</span>
        <button type="button" className="icon-btn img-lb-btn" title="关闭 (Esc)" onClick={onClose}>
          <X className="ic ic-sm" />
        </button>
      </div>
      <div
        className="doc-lightbox-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="doc-lightbox-panel" onClick={(e) => e.stopPropagation()}>
          {preview.kind === 'html' && (
            <iframe
              className="doc-lightbox-frame"
              title={preview.name}
              sandbox={HTML_PREVIEW_SANDBOX}
              srcDoc={preview.html}
            />
          )}
          {preview.kind === 'md' && (
            <div className="doc-lightbox-md">
              <TextBlock text={preview.text} />
            </div>
          )}
          {preview.kind === 'pdf' && (
            <iframe className="doc-lightbox-frame" title={preview.name} src={preview.url} />
          )}
          {preview.kind === 'meta' && (
            <div className="doc-lightbox-meta">
              <p>此类型暂无内容预览。</p>
              <p>
                <span className="doc-meta-k">文件</span> {preview.name}
              </p>
              <p>
                <span className="doc-meta-k">大小</span> {(preview.size / 1024).toFixed(1)} KB
              </p>
              {preview.path && (
                <p className="doc-meta-path">
                  <span className="doc-meta-k">路径</span> {preview.path}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 8

/** 滚轮 / ± / 双击缩放，拖拽平移；Esc 或点关闭关闭 */
function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  const zoomBy = (factor: number) => setScale((s) => clampZoom(s * factor))
  const resetView = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoomBy(1.2)
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2)
      else if (e.key === '0') resetView()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setScale((s) => clampZoom(s * factor))
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) })
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div className="img-lightbox" role="dialog" aria-modal="true" aria-label={name}>
      <div className="img-lightbox-bar">
        <span className="img-lightbox-cap">{name}</span>
        <span className="img-lightbox-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" className="icon-btn img-lb-btn" title="缩小 (−)" onClick={() => zoomBy(1 / 1.25)}>
          <Minus className="ic ic-sm" />
        </button>
        <button type="button" className="icon-btn img-lb-btn" title="放大 (+)" onClick={() => zoomBy(1.25)}>
          <Plus className="ic ic-sm" />
        </button>
        <button type="button" className="icon-btn img-lb-btn" title="重置 (0)" onClick={resetView}>
          <RotateCcw className="ic ic-sm" />
        </button>
        <button type="button" className="icon-btn img-lb-btn" title="关闭 (Esc)" onClick={onClose}>
          <X className="ic ic-sm" />
        </button>
      </div>
      <div
        ref={stageRef}
        className="img-lightbox-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
        onWheel={onWheel}
      >
        <img
          className="img-lightbox-pic"
          src={src}
          alt={name}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: drag.current ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => {
            if (scale > 1.05) resetView()
            else {
              setScale(2)
              setOffset({ x: 0, y: 0 })
            }
          }}
        />
      </div>
      <div className="img-lightbox-hint">滚轮缩放 · 拖拽平移 · 双击切换 100%/200%</div>
    </div>
  )
}

/** tool_result：本期不执行工具，灰色小字简单渲染 */
function ToolResultLine({
  tool,
  content,
  isError,
}: {
  tool: string
  content: string
  isError?: boolean
}) {
  return (
    <div className={`tool-result${isError ? ' error' : ''}`}>
      <span className="tr-tool">{tool}</span>
      {content}
    </div>
  )
}

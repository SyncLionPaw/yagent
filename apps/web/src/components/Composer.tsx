import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import {
  AtSign,
  Check,
  ChevronDown,
  Cloud,
  Command,
  CornerDownLeft,
  Laptop,
  MessageCircle,
  Mic,
  Paperclip,
  Smartphone,
  Zap,
} from 'lucide-react'
import type { Mode } from '@yagent/core'
import type { PopoverId } from './Topbar'

interface ComposerProps {
  draft: string
  mode: Mode
  popover: PopoverId
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onDraftChange: (v: string) => void
  onSend: () => void
  onModeChange: (m: Mode) => void
  onPopover: (id: PopoverId) => void
  onOpenVoice: () => void
}

const MODES: { id: Mode; label: string; title: string; desc: string; icon: typeof Laptop }[] = [
  { id: 'chat', label: '纯对话', title: '纯对话', desc: '只聊天问答，不执行任何操作', icon: MessageCircle },
  { id: 'local', label: '本地沙箱', title: 'Work · 本地沙箱', desc: '在本机隔离沙箱中执行任务', icon: Laptop },
  { id: 'cloud', label: '云端远程', title: 'Work · 云端远程', desc: '在云端运行，可用手机随时接管', icon: Cloud },
]

export function Composer({
  draft,
  mode,
  popover,
  textareaRef,
  onDraftChange,
  onSend,
  onModeChange,
  onPopover,
  onOpenVoice,
}: ComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null)
  const ta = textareaRef ?? localRef
  const modeOpen = popover === 'mode'
  const current = MODES.find((m) => m.id === mode) ?? MODES[1]
  const ModeIcon = current.icon

  // textarea 自适应高度：随内容长高，上限 180px（CSS max-height 控制内滚），发送后复位
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }, [draft, ta])

  return (
    <div className="composer">
      <div className="composer-box">
        <div className={`remote-hint${mode === 'cloud' ? ' show' : ''}`}>
          <Smartphone className="ic ic-sm" />
          远程控制已开启，手机端可接管此会话
          <span className="rh-link">
            连接手机
            <ChevronDown className="ic ic-sm" />
          </span>
        </div>

        <textarea
          ref={ta}
          placeholder="继续指示，⌘+Enter 发送，输入 / 使用命令…"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            // 输入法组词期间的 Enter 是确认候选，不触发发送
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
            // ⌘/Ctrl + Enter 发送，Enter 换行
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSend()
            }
          }}
        />

        <div className="composer-bar">
          <span
            className={`chip mode-chip${modeOpen ? ' open' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onPopover(modeOpen ? null : 'mode')
            }}
          >
            <ModeIcon className="ic ic-sm" />
            <span className="chip-text">{current.label}</span>
            <ChevronDown className="ic ic-sm ic-caret" />
          </span>
          <div
            className={`mode-pop${modeOpen ? ' open' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {MODES.map((m) => {
              const Icon = m.icon
              return (
                <button
                  key={m.id}
                  className={`mode-opt${m.id === mode ? ' active' : ''}`}
                  onClick={() => {
                    onModeChange(m.id)
                    onPopover(null)
                  }}
                >
                  <span className="m-icon">
                    <Icon className="ic" />
                  </span>
                  <span>
                    <span className="m-title">{m.title}</span>
                    <span className="m-desc">{m.desc}</span>
                  </span>
                  <span className="m-check">
                    <Check className="ic ic-sm" />
                  </span>
                </button>
              )
            })}
          </div>

          <span className="chip">
            <Paperclip className="ic ic-sm" />
            <span className="chip-text">附件</span>
          </span>
          <span className="chip">
            <AtSign className="ic ic-sm" />
            <span className="chip-text">引用文件</span>
          </span>
          <AutoRunChip />
          <button className="chip mic-chip" title="语音输入" onClick={onOpenVoice}>
            <Mic className="ic ic-sm" />
          </button>
          <button className="send" title="发送 (⌘+Enter)" onClick={onSend}>
            <Command className="ic send-ic" />
            <span className="send-plus">+</span>
            <CornerDownLeft className="ic send-ic" />
          </button>
        </div>
      </div>
    </div>
  )
}

function AutoRunChip() {
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span
      ref={ref}
      className="chip on"
      onClick={() => ref.current?.classList.toggle('on')}
    >
      <Zap className="ic ic-sm" />
      <span className="chip-text">自动执行</span>
    </span>
  )
}

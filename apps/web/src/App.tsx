import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation, Mode, Settings } from '@yagent/core'
import { MOCK_CONVERSATIONS, MOCK_SETTINGS } from './mock/data'
import { configureHarness, harness, pickInitialModel } from './harness'
import { Sidebar } from './components/Sidebar'
import { Topbar, type PopoverId } from './components/Topbar'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { VoiceOverlay } from './components/VoiceOverlay'
import { RightPanel, type PanelTab } from './components/RightPanel'
import { SettingsModal } from './components/SettingsModal'

type Theme = 'light' | 'dark'

const THEME_KEY = 'yagent-theme'
const SETTINGS_KEY = 'yagent-settings'

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 设置持久化：localStorage 里的覆盖 mock 默认；apiKeys 明文仅存本地 */
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return MOCK_SETTINGS
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      ...MOCK_SETTINGS,
      ...saved,
      apiKeys: { ...saved.apiKeys },
      tools: { ...MOCK_SETTINGS.tools, ...saved.tools },
      sandbox: { ...MOCK_SETTINGS.sandbox, ...saved.sandbox },
    }
  } catch {
    return MOCK_SETTINGS
  }
}

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 18 ? `${clean.slice(0, 18)}…` : clean
}

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  // 静态演示会话（c1-c6）保留为纯展示数据；真实会话由 harness 接管
  const [demoConvs, setDemoConvs] = useState<Conversation[]>(MOCK_CONVERSATIONS)
  const [activeConvId, setActiveConvId] = useState(MOCK_CONVERSATIONS[0].id)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('task')
  const [activeSrcId, setActiveSrcId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [popover, setPopover] = useState<PopoverId>(null)
  const [mode, setMode] = useState<Mode>('local')
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [currentModelId, setCurrentModelId] = useState(() =>
    pickInitialModel(settings.models, settings.apiKeys),
  )
  // harness 内部是可变对象，事件到达时 bump tick 触发重读
  const [, setHarnessTick] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const conversations: Conversation[] = [
    ...harness.listConversations().slice().reverse(),
    ...demoConvs,
  ]
  const conversation = conversations.find((c) => c.id === activeConvId) ?? conversations[0]
  const harnessConv = harness.getConversation(conversation.id)
  const running = harnessConv?.status === 'running'

  // 订阅 harness 事件 → 重渲染（conversations 重读活引用）
  useEffect(() => harness.on(() => setHarnessTick((t) => t + 1)), [])

  // 设置 / 当前模型 → 装配 harness provider（下一条消息生效）
  useEffect(() => {
    configureHarness(settings.models.find((m) => m.id === currentModelId), settings.apiKeys)
  }, [settings, currentModelId])

  // 主题：html data-theme 切换 + localStorage 持久化
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // 设置变更即持久化（含 BYOK 密钥，明文仅存本地）
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // 隐私模式等写失败忽略
    }
  }, [settings])

  // 全局快捷键：⌘B 侧栏；Esc 关设置 / 退语音
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarCollapsed((v) => !v)
      }
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false)
        else if (voiceOpen) setVoiceOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen, voiceOpen])

  // 弹层互斥：点击页面其他处全部关闭
  useEffect(() => {
    const close = () => setPopover(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  const patchDemoConv = useCallback((id: string, patch: (c: Conversation) => Conversation) => {
    setDemoConvs((list) => list.map((c) => (c.id === id ? patch(c) : c)))
  }, [])

  const handleRename = useCallback(
    (title: string) => {
      if (harness.getConversation(activeConvId)) harness.rename(activeConvId, title)
      else patchDemoConv(activeConvId, (c) => ({ ...c, title }))
    },
    [activeConvId, patchDemoConv],
  )

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      if (harness.getConversation(activeConvId)) harness.setActiveNode(activeConvId, nodeId)
      else patchDemoConv(activeConvId, (c) => ({ ...c, activeNodeId: nodeId }))
    },
    [activeConvId, patchDemoConv],
  )

  // 发送：当前是演示会话时先开真实会话；真实会话直接走 harness（流式由事件驱动 UI）
  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    let conv = harness.getConversation(activeConvId)
    if (!conv) {
      conv = harness.createConversation('新任务', null)
      setActiveConvId(conv.id)
    }
    if (conv.status === 'running') return // 流式中只允许停止
    if (conv.title === '新任务' && Object.keys(conv.nodes).length === 0) {
      harness.rename(conv.id, titleFrom(text))
    }
    setDraft('')
    // 错误（含缺 key / 网络失败）以 harness error 事件 + [error] 块呈现
    void harness.sendMessage(conv.id, text).catch(() => undefined)
  }, [draft, activeConvId])

  const handleStop = useCallback(() => harness.abort(activeConvId), [activeConvId])

  // 新建任务：harness 空会话（无目录纯聊天），直接进入
  const handleNewTask = useCallback(() => {
    const conv = harness.createConversation('新任务', null)
    setActiveConvId(conv.id)
    textareaRef.current?.focus()
  }, [])

  // ref 角标联动：展开右栏 + 切搜索页 + 高亮来源卡片
  const handleRefClick = useCallback((id: number) => {
    setPanelOpen(true)
    setPanelTab('search')
    setActiveSrcId(id)
  }, [])

  // artifact 卡片开关式联动：右栏开着且停在文件页 → 关闭；否则打开并切到文件页
  const handleToggleFiles = useCallback(() => {
    if (panelOpen && panelTab === 'files') {
      setPanelOpen(false)
    } else {
      setPanelOpen(true)
      setPanelTab('files')
    }
  }, [panelOpen, panelTab])

  // 语音完成：识别文本回填输入框（绝不直接发送）
  const handleVoiceConfirm = useCallback((text: string) => {
    setVoiceOpen(false)
    if (text) setDraft(text)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const handleDeleteModelGuard = (s: Settings) => {
    setSettings(s)
    if (!s.models.some((m) => m.id === currentModelId)) {
      setCurrentModelId(s.models[0]?.id ?? '')
    }
  }

  return (
    <div
      className={`app${sidebarCollapsed ? ' collapsed' : ''}${panelOpen ? ' panel-open' : ''}`}
    >
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        theme={theme}
        onSelect={setActiveConvId}
        onNewTask={handleNewTask}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="stage">
        <Topbar
          conversation={conversation}
          models={settings.models}
          currentModelId={currentModelId}
          popover={popover}
          onPopover={setPopover}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onTogglePanel={() => setPanelOpen((v) => !v)}
          onRename={handleRename}
          onSelectModel={setCurrentModelId}
        />
        <ChatView
          conversation={conversation}
          onRefClick={handleRefClick}
          onToggleFiles={handleToggleFiles}
        />
        <Composer
          draft={draft}
          mode={mode}
          popover={popover}
          running={running}
          textareaRef={textareaRef}
          onDraftChange={setDraft}
          onSend={handleSend}
          onStop={handleStop}
          onModeChange={setMode}
          onPopover={setPopover}
          onOpenVoice={() => setVoiceOpen(true)}
        />
        <VoiceOverlay
          open={voiceOpen}
          onCancel={() => setVoiceOpen(false)}
          onConfirm={handleVoiceConfirm}
        />
      </main>

      <RightPanel
        conversation={conversation}
        tab={panelTab}
        activeSrcId={activeSrcId}
        onTabChange={setPanelTab}
        onSelectNode={handleSelectNode}
        onSelectSrc={setActiveSrcId}
      />

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={handleDeleteModelGuard}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

export default App

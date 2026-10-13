import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation, Mode, Settings } from '@yagent/core'
import { MOCK_CONVERSATIONS, MOCK_REPLY, MOCK_SETTINGS } from './mock/data'
import { Sidebar } from './components/Sidebar'
import { Topbar, type PopoverId } from './components/Topbar'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { VoiceOverlay } from './components/VoiceOverlay'
import { RightPanel, type PanelTab } from './components/RightPanel'
import { SettingsModal } from './components/SettingsModal'

type Theme = 'light' | 'dark'

const THEME_KEY = 'yagent-theme'

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let nodeSeq = 0
const nextNodeId = () => `n-${Date.now()}-${nodeSeq++}`

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [conversations, setConversations] = useState<Conversation[]>(MOCK_CONVERSATIONS)
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
  const [settings, setSettings] = useState<Settings>(MOCK_SETTINGS)
  const [currentModelId, setCurrentModelId] = useState(
    MOCK_SETTINGS.models.find((m) => m.isDefault)?.id ?? MOCK_SETTINGS.models[0].id,
  )
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const conversation = conversations.find((c) => c.id === activeConvId) ?? conversations[0]

  // 主题：html data-theme 切换 + localStorage 持久化
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

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

  const updateConversation = useCallback((id: string, patch: (c: Conversation) => Conversation) => {
    setConversations((list) => list.map((c) => (c.id === id ? patch(c) : c)))
  }, [])

  const handleRename = useCallback(
    (title: string) => updateConversation(activeConvId, (c) => ({ ...c, title })),
    [activeConvId, updateConversation],
  )

  const handleSelectNode = useCallback(
    (nodeId: string) =>
      updateConversation(activeConvId, (c) => ({ ...c, activeNodeId: nodeId })),
    [activeConvId, updateConversation],
  )

  // 发送消息：追加用户节点 + 模拟 Agent 思考后回复（挂在 activeNodeId 之后）
  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    const now = Date.now()
    const userId = nextNodeId()
    const agentId = nextNodeId()
    updateConversation(activeConvId, (c) => ({
      ...c,
      nodes: {
        ...c.nodes,
        [userId]: {
          id: userId,
          parentId: c.activeNodeId || null,
          role: 'user',
          blocks: [{ type: 'text', text }],
          createdAt: now,
        },
        [agentId]: {
          id: agentId,
          parentId: userId,
          role: 'agent',
          blocks: [{ type: 'thinking', text: '正在思考…', status: 'streaming' }],
          createdAt: now,
        },
      },
      activeNodeId: agentId,
    }))
    setDraft('')
    setTimeout(() => {
      updateConversation(activeConvId, (c) => {
        const node = c.nodes[agentId]
        if (!node) return c
        return {
          ...c,
          nodes: {
            ...c.nodes,
            [agentId]: { ...node, blocks: [{ type: 'text', text: MOCK_REPLY }] },
          },
        }
      })
    }, 1400)
  }, [draft, activeConvId, updateConversation])

  // 新建任务：空会话（无目录纯聊天），直接进入
  const handleNewTask = useCallback(() => {
    const id = `c-${Date.now()}`
    setConversations((list) => [
      {
        id,
        title: '新任务',
        workdir: null,
        nodes: {},
        activeNodeId: '',
        status: 'done',
        refs: [],
        attachments: [],
        outputs: [],
      },
      ...list,
    ])
    setActiveConvId(id)
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
          textareaRef={textareaRef}
          onDraftChange={setDraft}
          onSend={handleSend}
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

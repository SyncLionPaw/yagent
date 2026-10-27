import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Info, ShieldAlert, X } from 'lucide-react'
import type {
  ContentWidth,
  ContextSnapshot,
  Conversation,
  Mode,
  Settings,
} from '@yagent/core'
import { DEFAULT_SETTINGS, settingsStore } from './settings'
import {
  configureHarness,
  harness,
  pickInitialModel,
  syncSkillsIntoHarness,
  updateToolsFor,
} from './harness'
import { matchSlashCommand, unknownSlashMessage } from './slashCommands'
import { conversationStore } from './conversations'
import { forgetProject, listProjects, rememberProject } from './projects'
import {
  registerApprovalHandler,
  setApprovalMode,
  type ApprovalMode,
  type ApprovalRequest,
} from './approval'
import { Sidebar } from './components/Sidebar'
import { Topbar, type PopoverId } from './components/Topbar'
import { ChatView } from './components/ChatView'
import { Composer, type ContextMeter, type PendingAttachment } from './components/Composer'
import {
  PANEL_W_DEFAULT,
  PANEL_W_MAX,
  PANEL_W_MIN,
  SIDEBAR_W_DEFAULT,
  SIDEBAR_W_MAX,
  SIDEBAR_W_MIN,
  Splitter,
} from './components/Splitter'
// 语音输入暂关
// import { VoiceOverlay } from './components/VoiceOverlay'
// import { resolveWhisperAuth } from './lib/speech'
import { RightPanel, type PanelTab } from './components/RightPanel'
import {
  SettingsPanel,
  userAvatarLetter,
  userNickname,
  type SettingsPaneId,
} from './components/SettingsPanel'
import { ConfirmDialog } from './components/ConfirmDialog'

type Theme = 'light' | 'dark'

const THEME_KEY = 'yagent-theme'
/** 旧版误用 localStorage 的迁移键，读一次后清除 */
const LEGACY_AUTO_APPROVE_KEY = 'yagent-auto-approve'

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 18 ? `${clean.slice(0, 18)}…` : clean
}

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  // 会话全部由 harness 持有（启动时已恢复 + 播种，见 main.tsx）
  const [activeConvId, setActiveConvId] = useState(() => harness.listConversations()[0]?.id ?? '')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('files')
  const [activeSrcId, setActiveSrcId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>('models')
  const [popover, setPopover] = useState<PopoverId>(null)
  const [mode, setMode] = useState<Mode>('local')
  // 语音输入暂关
  // const [voiceOpen, setVoiceOpen] = useState(false)
  // 工具审批队列（write_file / run_command），输入框上方横条逐条确认
  const [approvals, setApprovals] = useState<
    { id: number; req: ApprovalRequest; resolve: (ok: boolean) => void }[]
  >([])
  const [draft, setDraft] = useState('')
  /** slash 命令执行后的短暂提示（输入框上方） */
  const [slashNotice, setSlashNotice] = useState('')
  /** 正在主输入区编辑的已发送用户节点；null = 普通新消息 */
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([])
  const [knownProjects, setKnownProjects] = useState<string[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const approvalMode: ApprovalMode =
    settings.tools.approvalMode ?? (settings.tools.autoApprove ? 'all' : 'ask')
  // 加载完成前不持久化，避免启动时用默认值覆盖磁盘 / 旧存储
  const loadedRef = useRef(false)
  const models = settings.models
  const [currentModelId, setCurrentModelId] = useState(() =>
    pickInitialModel(models),
  )
  // harness 内部是可变对象，事件到达时 bump tick 触发重读
  const [, setHarnessTick] = useState(0)
  const [contextSnap, setContextSnap] = useState<ContextSnapshot | null>(null)
  /** 推拉中的实时宽度；null = 跟 settings */
  const [sidebarWidthLive, setSidebarWidthLive] = useState<number | null>(null)
  const [panelWidthLive, setPanelWidthLive] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const sidebarWidth =
    sidebarWidthLive ??
    clampPanelW(settings.appearance?.sidebarWidth, SIDEBAR_W_DEFAULT, SIDEBAR_W_MIN, SIDEBAR_W_MAX)
  const panelWidth =
    panelWidthLive ??
    clampPanelW(settings.appearance?.panelWidth, PANEL_W_DEFAULT, PANEL_W_MIN, PANEL_W_MAX)

  const commitSidebarWidth = useCallback((w: number) => {
    setSidebarWidthLive(null)
    setSettings((s) => ({
      ...s,
      appearance: { ...s.appearance, sidebarWidth: w },
    }))
  }, [])
  const commitPanelWidth = useCallback((w: number) => {
    setPanelWidthLive(null)
    setSettings((s) => ({
      ...s,
      appearance: { ...s.appearance, panelWidth: w },
    }))
  }, [])

  const conversations: Conversation[] = harness.listConversations().slice().reverse()
  const conversation = conversations.find((c) => c.id === activeConvId) ?? conversations[0]
  const harnessConv = conversation ? harness.getConversation(conversation.id) : undefined
  const running = harnessConv?.status === 'running'
  const contextMeter: ContextMeter | null = contextSnap ? toContextMeter(contextSnap) : null

  // 订阅 harness 事件 → 重渲染（conversations 重读活引用）
  // rAF 合帧：token 突发时一帧内多个事件只触发一次渲染
  useEffect(() => {
    let raf = 0
    const unsub = harness.on((e) => {
      if (e.type === 'context_updated' && e.convId === activeConvId) {
        setContextSnap(e.snapshot)
      }
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setHarnessTick((t) => t + 1)
      })
    })
    return () => {
      cancelAnimationFrame(raf)
      unsub()
    }
  }, [activeConvId])

  // 切换会话时拉一次估算占用（不依赖刚跑过的 usage）
  useEffect(() => {
    setContextSnap(readContextSnapshot(activeConvId))
  }, [activeConvId])

  // 设置 / 当前模型 → 装配 harness provider（下一条消息生效）
  useEffect(() => {
    configureHarness(models.find((m) => m.id === currentModelId))
    setContextSnap(readContextSnapshot(activeConvId))
  }, [models, currentModelId, activeConvId])

  // Skills L1：启动时扫 ~/.yagent/skills（dev 为 ./.yagent/skills）写入 system
  useEffect(() => {
    void syncSkillsIntoHarness()
  }, [])

  // slash 结果条：复用审批条位置，数秒后自动收起
  useEffect(() => {
    if (!slashNotice) return
    const t = setTimeout(() => setSlashNotice(''), 3600)
    return () => clearTimeout(t)
  }, [slashNotice])

  // 主题：html data-theme 切换 + localStorage 持久化
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // 强调色：html data-accent，随 settings 持久化
  useEffect(() => {
    document.documentElement.dataset.accent = settings.appearance?.accent ?? 'violet'
  }, [settings.appearance?.accent])

  // 内容列宽：data-content-width → CSS --content-max
  useEffect(() => {
    document.documentElement.dataset.contentWidth =
      settings.appearance?.contentWidth ?? 'standard'
  }, [settings.appearance?.contentWidth])

  // 启动恢复会话 + 项目登记（有会话的 workdir 补写 project.json，删光后仍能显示空项目）
  useEffect(() => {
    void (async () => {
      await conversationStore.loadAll().catch(() => undefined)
      for (const c of harness.listConversations()) {
        if (c.workdir?.trim()) await rememberProject(c.workdir)
      }
      setKnownProjects(await listProjects())
    })()
  }, [])

  const trackProject = useCallback((workdir: string | null | undefined) => {
    const wd = workdir?.trim()
    if (!wd) return
    setKnownProjects((list) => (list.includes(wd) ? list : [wd, ...list]))
    void rememberProject(wd)
  }, [])

  // 启动加载设置（Electron → dataDir/settings.json，浏览器 → localStorage）；
  // 加载完成后按加载到的设置重新选择初始模型（等价于原同步 loadSettings 的行为）
  useEffect(() => {
    void settingsStore.load().then((s) => {
      let next = s
      // 迁移：曾误存 localStorage 的自动执行 → settings.tools
      try {
        const legacy = localStorage.getItem(LEGACY_AUTO_APPROVE_KEY)
        if (legacy !== null) {
          next = {
            ...s,
            tools: { ...s.tools, autoApprove: legacy === '1' || !!s.tools.autoApprove },
          }
          localStorage.removeItem(LEGACY_AUTO_APPROVE_KEY)
        }
      } catch {
        //
      }
      loadedRef.current = true
      setSettings(next)
      setCurrentModelId(pickInitialModel(next.models))
    })
  }, [])

  // 设置变更即持久化（含 BYOK 密钥、autoApprove；桌面写 settings.json）；写失败静默
  useEffect(() => {
    if (!loadedRef.current) return
    void settingsStore.save(settings).catch(() => undefined)
  }, [settings])

  // 全局快捷键：⌘B 侧栏；Esc 关设置
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarCollapsed((v) => !v)
      }
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false)
        // else if (voiceOpen) setVoiceOpen(false) // 语音输入暂关
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  // 弹层互斥：点击页面其他处全部关闭
  useEffect(() => {
    const close = () => setPopover(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // 工具审批：executor 的请求推进队列，横条逐条展示
  useEffect(() => {
    let seq = 0
    registerApprovalHandler(
      (req) =>
        new Promise<boolean>((resolve) => {
          setApprovals((list) => [...list, { id: ++seq, req, resolve }])
        }),
    )
  }, [])

  // 审批档位同步；升到更宽档位时放行走完已不需要确认的排队项
  useEffect(() => {
    setApprovalMode(approvalMode)
    setApprovals((list) => {
      const keep: typeof list = []
      for (const a of list) {
        const auto =
          approvalMode === 'all' || (approvalMode === 'files' && a.req.name === 'write_file')
        if (auto) a.resolve(true)
        else keep.push(a)
      }
      return keep
    })
  }, [approvalMode])

  const handleApprovalModeChange = useCallback((mode: ApprovalMode) => {
    setSettings((s) => ({
      ...s,
      tools: { ...s.tools, approvalMode: mode, autoApprove: mode === 'all' },
    }))
  }, [])

  const handleRename = useCallback((title: string) => {
    if (harness.getConversation(activeConvId)) harness.rename(activeConvId, title)
  }, [activeConvId])

  const handleToggleArchive = useCallback(() => {
    const conv = harness.getConversation(activeConvId)
    if (!conv) return
    const next = !conv.archived
    harness.setArchived(activeConvId, next)
    // 归档后切到下一条未归档会话，避免停在已隐藏项上
    if (next) {
      const rest = harness.listConversations().filter((c) => c.id !== activeConvId && !c.archived)
      if (rest.length) setActiveConvId(rest[rest.length - 1]!.id)
    }
  }, [activeConvId])

  // 会话切换时，如果是真实会话则更新工具配置
  useEffect(() => {
    if (harness.getConversation(activeConvId)) {
      updateToolsFor(activeConvId, settings.tools)
    }
  }, [activeConvId, settings.tools])

  // 未发送过消息的空会话：同 workdir（含纯对话的 null）直接复用，避免堆空白项
  const openOrCreate = useCallback(
    (title: string, workdir: string | null) => {
      const empty = harness
        .listConversations()
        .find((c) => !c.archived && c.workdir === workdir && Object.keys(c.nodes).length === 0)
      if (empty) {
        setActiveConvId(empty.id)
        trackProject(workdir)
        textareaRef.current?.focus()
        return empty
      }
      const conv = harness.createConversation(title, workdir)
      setActiveConvId(conv.id)
      if (workdir) updateToolsFor(conv.id, settings.tools)
      trackProject(workdir)
      textareaRef.current?.focus()
      return conv
    },
    [settings.tools, trackProject],
  )

  const handleDeleteConversation = useCallback(() => {
    const conv = harness.getConversation(activeConvId)
    if (!conv) return
    setDeleteConfirm({ id: conv.id, title: conv.title })
  }, [activeConvId])

  const confirmDeleteConversation = useCallback(() => {
    const pending = deleteConfirm
    setDeleteConfirm(null)
    if (!pending) return
    const conv = harness.getConversation(pending.id)
    if (!conv) return
    const id = conv.id
    const workdir = conv.workdir
    const extraPaths = conv.attachments
      .map((a) => a.name)
      .filter((p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))
    // 先切到下一条（或新建），避免删掉当前项后短暂无会话导致渲染空引用
    const rest = harness.listConversations().filter((c) => c.id !== id)
    if (rest.length) {
      setActiveConvId(rest[0]!.id)
    } else {
      const fresh = harness.createConversation('新对话', null)
      setActiveConvId(fresh.id)
    }
    setPendingFiles([])
    setDraft('')
    void (async () => {
      await conversationStore.remove(id)
      await window.yagentDesktop?.attachments
        ?.purge?.(id, workdir, extraPaths)
        .catch(() => undefined)
    })()
  }, [deleteConfirm])

  // 切换会话时清空未发送附件 / 编辑态，避免串台
  useEffect(() => {
    setPendingFiles([])
    setEditingNodeId(null)
  }, [activeConvId])

  const cancelEditMessage = useCallback(() => {
    setEditingNodeId(null)
    setDraft('')
  }, [])

  const startEditUserMessage = useCallback((nodeId: string, text: string) => {
    setEditingNodeId(nodeId)
    setDraft(text)
    setPendingFiles([])
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.selectionStart = el.value.length
      el.selectionEnd = el.value.length
    })
  }, [])

  /** 编辑已发送的用户消息：从该节点父级分叉，保留原附件，重跑一轮 */
  const handleEditUserMessage = useCallback(
    (nodeId: string, nextVisible: string) => {
      const conv = harness.getConversation(activeConvId)
      if (!conv || conv.status === 'running') return
      const node = conv.nodes[nodeId]
      if (!node || (node.role !== 'round' && node.role !== 'user')) return

      const textBlock = node.blocks.find((b) => b.type === 'text')
      const raw = textBlock?.type === 'text' ? textBlock.text : ''
      const zw = raw.indexOf('\u200c')
      const notes = zw >= 0 ? raw.slice(zw) : ''
      const visible = nextVisible.trimEnd() || (notes ? '请查看附件' : '')
      const message = notes ? `${visible}\n\n${notes}` : visible

      const images: { mime: string; name: string; path?: string; data: string }[] = []
      const files: {
        name: string
        size: number
        path?: string
        mime?: string
        preview?:
          | { kind: 'html'; html: string }
          | { kind: 'md'; text: string }
          | { kind: 'pdf'; dataUrl: string }
      }[] = []
      if (node.role === 'round') {
        for (let i = 1; i < node.blocks.length; i++) {
          const b = node.blocks[i]
          if (b.type === 'image') {
            images.push({ mime: b.mime, name: b.name, path: b.path, data: b.data })
          } else if (b.type === 'file') {
            files.push({
              name: b.name,
              size: b.size,
              path: b.path,
              mime: b.mime,
              preview: b.preview,
            })
          } else break
        }
      }

      harness.setActiveNode(conv.id, node.parentId ?? '')
      updateToolsFor(conv.id, settings.tools)
      void (async () => {
        await syncSkillsIntoHarness()
        await harness.sendMessage(conv.id, message, {
          ...(images.length ? { images } : {}),
          ...(files.length ? { files } : {}),
        })
      })().catch(() => undefined)
    },
    [activeConvId, settings.tools],
  )

  // 发送附件策略：≤1KB 文本内联+路径；图片走多模态；其余只给路径让工具读
  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text && pendingFiles.length === 0) return

    // Slash：本地命令，不进模型（编辑已发消息时仍按普通文本）
    if (!editingNodeId && pendingFiles.length === 0) {
      const cmd = matchSlashCommand(text)
      if (cmd) {
        setDraft('')
        void cmd.run().then((r) => setSlashNotice(r.message))
        return
      }
      const unknown = unknownSlashMessage(text)
      if (unknown) {
        setDraft('')
        setSlashNotice(unknown)
        return
      }
    }

    let conv = harness.getConversation(activeConvId)
    if (!conv) {
      conv = openOrCreate('新对话', null)
    }
    if (conv.status === 'running') return // 流式中只允许停止

    // 编辑已发送消息：分叉重跑，不走新附件上传
    if (editingNodeId) {
      const nodeId = editingNodeId
      const next = draft
      setEditingNodeId(null)
      setDraft('')
      setPendingFiles([])
      handleEditUserMessage(nodeId, next)
      return
    }

    const titleSeed = text || pendingFiles[0]?.name || '新对话'
    if (
      (conv.title === '新任务' || conv.title === '新对话') &&
      Object.keys(conv.nodes).length === 0
    ) {
      harness.rename(conv.id, titleFrom(titleSeed))
    }
    const files = pendingFiles
    setDraft('')
    setPendingFiles([])
    updateToolsFor(conv.id, settings.tools)
    void (async () => {
      await syncSkillsIntoHarness()
      // 气泡只显示用户原文；给模型的附件说明 / 内联文本另附，UI 会折叠成附件条
      const saved: { name: string; size: number }[] = []
      const modelNotes: string[] = []
      const images: { mime: string; name: string; path?: string; data: string }[] = []
      const fileCards: {
        name: string
        size: number
        path?: string
        mime?: string
        preview?:
          | { kind: 'html'; html: string }
          | { kind: 'md'; text: string }
          | { kind: 'pdf'; dataUrl: string }
      }[] = []
      const writeAtt = window.yagentDesktop?.attachments?.write
      for (const a of files) {
        let absPath = ''
        let writeErr = ''
        const base64 = await fileToBase64(a.file)
        if (writeAtt) {
          try {
            absPath = await writeAtt(conv.id, a.name, base64, conv.workdir)
          } catch (err) {
            writeErr = err instanceof Error ? err.message : String(err)
            console.warn('[yagent] attachments:write failed', a.name, writeErr)
          }
        } else if (window.yagentDesktop) {
          writeErr = 'attachments API 不可用（请重启桌面端以加载最新 preload）'
          console.warn('[yagent]', writeErr)
        }
        const loc = absPath || a.name
        saved.push({ name: loc, size: a.size })

        if (isImageAttach(a.file)) {
          const mime = a.file.type || imageMimeFromName(a.name)
          images.push({ mime, name: a.name, path: absPath || undefined, data: base64 })
          if (absPath) {
            modelNotes.push(
              `\n\n[附件: ${a.name} · 图片 · ${formatAttachSize(a.size)}]\n绝对路径（read_file 请原样使用，勿猜测）: ${absPath}`,
            )
          }
        } else {
          const preview = await buildFilePreview(a.file, a.name)
          fileCards.push({
            name: a.name,
            size: a.size,
            path: absPath || undefined,
            mime: a.file.type || undefined,
            preview,
          })
          // 短文本或落盘失败时内联；有绝对路径时务必写明，禁止只说「去读」却不给路径
          const textual = isTextualAttach(a.file)
          const inlineFallback = !absPath && textual && a.file.size <= INLINE_FALLBACK_MAX
          const shouldInline =
            (textual && a.file.size <= INLINE_ATTACH_MAX) || inlineFallback
          if (shouldInline) {
            const body = (await a.file.text()).slice(0, INLINE_FALLBACK_MAX)
            const lang = fenceLang(a.name)
            const pathLine = absPath
              ? `\n绝对路径（内容已内联；一般无需再读）: ${absPath}`
              : writeErr
                ? `\n（未落盘: ${writeErr}）`
                : ''
            modelNotes.push(
              `\n\n[附件: ${a.name} · ${formatAttachSize(a.size)}]${pathLine}\n\`\`\`${lang}\n${body}\n\`\`\``,
            )
          } else if (absPath) {
            modelNotes.push(
              `\n\n[附件: ${a.name} · ${formatAttachSize(a.size)}]\n绝对路径（请用 read_file 原样读取，勿改写或猜测相对路径）: ${absPath}`,
            )
          } else {
            modelNotes.push(
              `\n\n[附件: ${a.name} · ${formatAttachSize(a.size)} · 未能保存到应用目录${writeErr ? `（${writeErr}）` : ''}，无可用路径，请根据文件名请用户重试]`,
            )
          }
        }
      }
      if (saved.length) harness.addAttachments(conv.id, saved)
      const visible = text || (files.length ? '请查看附件' : '')
      // 用不可见分隔把「用户可见」与「模型附注」切开，ChatView 只渲染前半
      const message =
        modelNotes.length > 0 ? `${visible}\n\n\u200c${modelNotes.join('')}` : visible
      await harness
        .sendMessage(conv.id, message, {
          ...(images.length ? { images } : {}),
          ...(fileCards.length ? { files: fileCards } : {}),
        })
        .catch(() => undefined)
    })()
  }, [
    draft,
    pendingFiles,
    activeConvId,
    settings.tools,
    openOrCreate,
    editingNodeId,
    handleEditUserMessage,
  ])

  const handleStop = useCallback(() => harness.abort(activeConvId), [activeConvId])

  // 绑定工作目录：打开文件夹选择对话框
  const handleBindWorkdir = useCallback(async () => {
    const selectedPath = await window.yagentDesktop?.dialog?.selectDirectory?.()
    if (selectedPath) {
      harness.setWorkdir(activeConvId, selectedPath)
      updateToolsFor(activeConvId, settings.tools)
      trackProject(selectedPath)
    }
  }, [activeConvId, settings.tools, trackProject])

  const handleForgetProject = useCallback((workdir: string) => {
    setKnownProjects((list) => list.filter((w) => w !== workdir))
    void forgetProject(workdir)
  }, [])

  // 新建任务：先选工作目录，选中才建会话并绑定；取消则不动
  const handleNewTask = useCallback(async () => {
    const dir = await window.yagentDesktop?.dialog?.selectDirectory?.()
    if (!dir) {
      // 无目录选择桥（纯浏览器环境）：退化为纯聊天会话
      if (!window.yagentDesktop) openOrCreate('新对话', null)
      return
    }
    openOrCreate('新任务', dir)
  }, [openOrCreate])

  // 新建纯聊天对话（不绑定工作目录）
  const handleNewChat = useCallback(() => {
    openOrCreate('新对话', null)
  }, [openOrCreate])

  // 在已有项目（目录）下直接新建任务，无需再选目录
  const handleNewTaskInProject = useCallback(
    (workdir: string) => {
      openOrCreate('新任务', workdir)
    },
    [openOrCreate],
  )

  // ref 角标联动：展开右栏 → 浏览器 tab 打开该来源
  const handleRefClick = useCallback((id: number) => {
    setPanelOpen(true)
    setActiveSrcId(id)
    setPanelTab('browser')
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

  // 语音输入暂关
  // const handleVoiceConfirm = useCallback((text: string) => {
  //   setVoiceOpen(false)
  //   if (text) setDraft(text)
  //   requestAnimationFrame(() => textareaRef.current?.focus())
  // }, [])

  const handleDeleteModelGuard = (s: Settings) => {
    setSettings(s)
    if (!s.models.some((m) => m.id === currentModelId)) {
      setCurrentModelId(s.models[0]?.id ?? '')
    }
  }

  if (!conversation) {
    return (
      <div className="app">
        <div className="stage" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-1)' }}>
          正在准备会话…
        </div>
      </div>
    )
  }

  return (
    <div
      className={`app${sidebarCollapsed ? ' collapsed' : ''}${panelOpen ? ' panel-open' : ''}`}
      style={
        {
          '--sidebar-w': `${sidebarWidth}px`,
          '--panel-w': `${panelWidth}px`,
        } as CSSProperties
      }
    >
      {window.yagentDesktop && <div className="drag-region" />}
      <Sidebar
        conversations={conversations}
        knownProjects={knownProjects}
        activeId={activeConvId}
        theme={theme}
        settingsOpen={settingsOpen}
        settingsPane={settingsPane}
        nickname={userNickname(settings)}
        avatarLetter={userAvatarLetter(settings)}
        onSelect={setActiveConvId}
        onNewChat={handleNewChat}
        onNewTaskWithWorkdir={handleNewTask}
        onNewTaskInProject={handleNewTaskInProject}
        onForgetProject={handleForgetProject}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
        onOpenUserSettings={() => {
          if (settingsOpen) {
            setSettingsOpen(false)
            return
          }
          setSettingsPane('user')
          setSettingsOpen(true)
        }}
        onSelectSettingsPane={setSettingsPane}
      />
      <Splitter
        edge="left"
        value={sidebarWidth}
        min={SIDEBAR_W_MIN}
        max={SIDEBAR_W_MAX}
        defaultValue={SIDEBAR_W_DEFAULT}
        onChange={setSidebarWidthLive}
        onCommit={commitSidebarWidth}
      />

      <main className="stage">
        <div className={`flip-inner${settingsOpen ? ' flipped' : ''}`}>
          <div className="flip-front">
            <Topbar
              conversation={conversation}
              models={models}
              currentModelId={currentModelId}
              contentWidth={settings.appearance?.contentWidth ?? 'standard'}
              popover={popover}
              onPopover={setPopover}
              onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
              onTogglePanel={() => setPanelOpen((v) => !v)}
              onRename={handleRename}
              onSelectModel={setCurrentModelId}
              onContentWidth={(w: ContentWidth) =>
                setSettings((s) => ({
                  ...s,
                  appearance: { ...s.appearance, contentWidth: w },
                }))
              }
              onBindWorkdir={handleBindWorkdir}
              onToggleArchive={handleToggleArchive}
              onDelete={handleDeleteConversation}
            />
            <ChatView
              conversation={conversation}
              editingNodeId={editingNodeId}
              onRefClick={handleRefClick}
              onToggleFiles={handleToggleFiles}
              onStartEditUserMessage={startEditUserMessage}
            />
            <Composer
              draft={draft}
              mode={mode}
              popover={popover}
              running={running}
              textareaRef={textareaRef}
              attachments={pendingFiles}
              editingMessage={!!editingNodeId}
              context={contextMeter}
              approvalMode={approvalMode}
              approval={
                approvalMode !== 'all' && approvals.length > 0 ? (
                  <ApprovalBar
                    req={approvals[0].req}
                    onAnswer={(ok) => {
                      approvals[0].resolve(ok)
                      setApprovals((l) => l.slice(1))
                    }}
                  />
                ) : slashNotice ? (
                  <ComposerNoticeBar
                    message={slashNotice}
                    onDismiss={() => setSlashNotice('')}
                  />
                ) : null
              }
              onDraftChange={setDraft}
              onAttachmentsChange={setPendingFiles}
              onSend={handleSend}
              onStop={handleStop}
              onModeChange={setMode}
              onPopover={setPopover}
              // onOpenVoice={() => setVoiceOpen(true)} // 语音输入暂关
              onApprovalModeChange={handleApprovalModeChange}
              onCancelEdit={cancelEditMessage}
            />
            {/* 语音输入暂关
            <VoiceOverlay
              open={voiceOpen}
              whisper={resolveWhisperAuth(settings)}
              onCancel={() => setVoiceOpen(false)}
              onConfirm={handleVoiceConfirm}
            />
            */}
          </div>
          <div className="flip-back">
            <SettingsPanel
              pane={settingsPane}
              settings={settings}
              conversations={conversations}
              onChange={handleDeleteModelGuard}
              onClose={() => setSettingsOpen(false)}
            />
          </div>
        </div>
      </main>

      <Splitter
        edge="right"
        value={panelWidth}
        min={PANEL_W_MIN}
        max={PANEL_W_MAX}
        defaultValue={PANEL_W_DEFAULT}
        onChange={setPanelWidthLive}
        onCommit={commitPanelWidth}
      />
      <RightPanel
        conversation={conversation}
        tab={panelTab}
        activeSrcId={activeSrcId}
        onTabChange={setPanelTab}
        onSelectSrc={setActiveSrcId}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        title="删除对话"
        message={
          deleteConfirm
            ? `确定删除「${deleteConfirm.title}」？相关附件会一并删除，且不可恢复。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={confirmDeleteConversation}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  )
}

export default App

function clampPanelW(
  raw: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function formatTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(Math.round(n))
}

/** 分段色：接近 Cursor Context Usage 面板的区分度 */
const CTX_COLORS = {
  system: '#8b8b96',
  tools: '#7c6cf0',
  conversation: '#e85d4c',
  toolResults: '#c44d7a',
} as const

function readContextSnapshot(convId: string): ContextSnapshot | null {
  if (!convId || !harness.getConversation(convId)) return null
  try {
    return harness.getContextSnapshot(convId)
  } catch {
    return null
  }
}

function toContextMeter(snap: ContextSnapshot): ContextMeter {
  const limit = Math.max(1, snap.limit || 128_000)
  const estimated = Math.max(0, snap.estimated || 0)
  const ratio = snap.ratio ?? estimated / limit
  const pct = Math.round(Math.min(Math.max(ratio, 0), 9.99) * 100)
  const b = snap.breakdown ?? { system: 0, tools: 0, messages: estimated, toolResults: 0 }
  const toolResults = Math.min(b.toolResults || 0, b.messages || 0)
  const conversationTok = Math.max(0, (b.messages || 0) - toolResults)
  const segments: ContextMeter['segments'] = [
    { id: 'system', label: '系统提示', tokens: b.system || 0, color: CTX_COLORS.system },
    { id: 'tools', label: '工具定义', tokens: b.tools || 0, color: CTX_COLORS.tools },
    { id: 'conversation', label: '对话', tokens: conversationTok, color: CTX_COLORS.conversation },
  ]
  if (toolResults > 0) {
    segments.push({
      id: 'toolResults',
      label: '工具结果',
      tokens: toolResults,
      color: CTX_COLORS.toolResults,
    })
  }
  const notes: NonNullable<ContextMeter['notes']> = []
  if (snap.lastUsage?.cacheRead != null) {
    notes.push({
      label: '缓存命中',
      value:
        snap.cacheHitRatio != null
          ? `${formatTok(snap.lastUsage.cacheRead)} · ${Math.round(snap.cacheHitRatio * 100)}%`
          : formatTok(snap.lastUsage.cacheRead),
    })
  }
  if (snap.lastUsage?.cacheWrite != null && snap.lastUsage.cacheWrite > 0) {
    notes.push({ label: '缓存写入', value: formatTok(snap.lastUsage.cacheWrite) })
  }
  if (snap.trimmed && snap.trimmedTokens > 0) {
    notes.push({ label: '已裁剪', value: `约 ${formatTok(snap.trimmedTokens)}` })
  }
  return {
    ratio,
    limit,
    pctLabel: `${pct}%`,
    tokensLabel: `~${formatTok(estimated)} / ${formatTok(limit)}`,
    segments: segments.filter((s) => s.tokens > 0),
    ...(notes.length ? { notes } : {}),
  }
}

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

/** ≤1KB 的文本类文件直接塞进上下文 */
const INLINE_ATTACH_MAX = 1024
/** 落盘失败时文本最多内联这么多，避免模型无路径可猜 */
const INLINE_FALLBACK_MAX = 100_000

function isImageAttach(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(file.name)
}

function imageMimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  }
  return map[ext] ?? 'image/png'
}

function isTextualAttach(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  if (file.type === 'application/json') return true
  return /\.(md|markdown|txt|csv|tsv|json|jsonc|ya?ml|toml|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|vue|svelte|sql|sh|bash|zsh|graphql|gql|ini|cfg|conf)$/i.test(
    file.name,
  )
}

/** 与 Composer 缩略卡对齐：html / md / 小 pdf 写入会话，便于气泡旁复用 */
async function buildFilePreview(
  file: File,
  name: string,
): Promise<
  | { kind: 'html'; html: string }
  | { kind: 'md'; text: string }
  | { kind: 'pdf'; dataUrl: string }
  | undefined
> {
  const lower = name.toLowerCase()
  try {
    if (/\.html?$/.test(lower) || file.type === 'text/html') {
      return { kind: 'html', html: (await file.text()).slice(0, 80_000) }
    }
    if (/\.(md|markdown)$/.test(lower) || file.type === 'text/markdown') {
      return { kind: 'md', text: (await file.text()).slice(0, 12_000) }
    }
    if ((/\.pdf$/.test(lower) || file.type === 'application/pdf') && file.size <= 1.5 * 1024 * 1024) {
      return { kind: 'pdf', dataUrl: `data:application/pdf;base64,${await fileToBase64(file)}` }
    }
  } catch {
    // 预览失败不影响发送
  }
  return undefined
}

function fenceLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    md: 'markdown',
    markdown: 'markdown',
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    html: 'html',
    htm: 'html',
    css: 'css',
    sh: 'bash',
    sql: 'sql',
  }
  return map[ext] ?? ext
}

function formatAttachSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 工具审批条：贴在输入框上沿（略短、凹弧过渡），逐条确认危险操作 */
function ApprovalBar({
  req,
  onAnswer,
}: {
  req: ApprovalRequest
  onAnswer: (ok: boolean) => void
}) {
  const detail = String(req.input.command ?? req.input.path ?? '')
  return (
    <div className="approval-bar">
      <ShieldAlert className="ic ab-icon" />
      <code className="ab-detail">{detail}</code>
      <span className="ab-actions">
        <button type="button" className="ab-btn ab-deny" title="拒绝" aria-label="拒绝" onClick={() => onAnswer(false)}>
          <X className="ic" />
        </button>
        <button type="button" className="ab-btn ab-allow" title="允许" aria-label="允许" onClick={() => onAnswer(true)}>
          <Check className="ic" />
        </button>
      </span>
    </div>
  )
}

/** slash 等本地命令结果：复用审批条外形，贴在输入框上方 */
function ComposerNoticeBar({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="approval-bar approval-bar-notice" role="status">
      <Info className="ic ab-icon" />
      <span className="ab-detail ab-detail-plain">{message}</span>
      <span className="ab-actions">
        <button type="button" className="ab-btn" title="关闭" aria-label="关闭" onClick={onDismiss}>
          <X className="ic" />
        </button>
      </span>
    </div>
  )
}

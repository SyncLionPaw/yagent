import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  Code2,
  FolderOpen,
  Globe,
  HardDrive,
  Hash,
  Layers,
  PenTool,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react'
import type {
  AccentId,
  Conversation,
  KnowledgeSource,
  KnowledgeSourceKind,
  ModelConfig,
  Settings,
} from '@yagent/core'
import { BrandIcon } from './BrandIcons'
import {
  devDeepseekKey,
  keyHasBadChars,
  maskKey,
  syncSkillsIntoHarness,
  testConnection,
} from '../harness'
import {
  createSkill,
  deleteSkill,
  listSkills,
  readSkill,
  skillsAvailable,
  skillsRoot,
  writeSkill,
  type SkillSummary,
} from '../skills'

export type SettingsPaneId =
  | 'user'
  | 'models'
  | 'appearance'
  | 'skills'
  | 'knowledge'
  | 'tools'
  | 'connectors'

interface SettingsPanelProps {
  pane: SettingsPaneId
  settings: Settings
  conversations: Conversation[]
  onChange: (settings: Settings) => void
  onClose: () => void
}

const PANE_META: Record<SettingsPaneId, [string, string]> = {
  user: ['用户', '本机昵称、头像字标，以及近一年对话打卡'],
  models: ['模型配置', '每个模型条目自带密钥与端点（BYOK），仅存储在本地'],
  appearance: ['外观', '主题强调色会应用到按钮、高亮与边缘光等全局样式'],
  skills: ['技能', '按 Cursor 风格管理 SKILL.md，默认存放在 .yagent/skills/'],
  knowledge: ['知识库', '连接本地目录或云端文档源，供 Agent 检索引用'],
  tools: ['工具', '配置 Agent 的默认工具与沙箱'],
  connectors: ['连接器', '连接外部服务，让 Agent 读写你的工具和数据'],
}

export function userNickname(settings: Settings): string {
  const n = settings.user?.nickname?.trim()
  return n || '用户'
}

export function userAvatarLetter(settings: Settings): string {
  const n = userNickname(settings)
  return Array.from(n)[0]?.toUpperCase() ?? 'U'
}

const ACCENT_OPTIONS: { id: AccentId; label: string; desc: string; swatch: string }[] = [
  { id: 'violet', label: '紫罗兰', desc: '默认强调色', swatch: '#6c5ce7' },
  { id: 'frost-green', label: '磨砂绿', desc: '青调抹茶', swatch: '#1faa6e' },
  { id: 'summer-orange', label: '盛夏橙', desc: '热烈夏日', swatch: '#e07a3a' },
  { id: 'ice-blue', label: '冰晶蓝', desc: '清冽冰蓝', swatch: '#3d8fd1' },
  { id: 'sakura-pink', label: '初樱粉', desc: '淡樱初放', swatch: '#e08aa4' },
  { id: 'maple-red', label: '枫红', desc: '秋枫鲜红', swatch: '#d63b3b' },
]

/** 设置页：渲染在舞台翻面后的背面（非弹窗），左侧菜单在侧栏里 */
export function SettingsPanel({
  pane,
  settings,
  conversations,
  onChange,
  onClose,
}: SettingsPanelProps) {
  const [title, desc] = PANE_META[pane]

  return (
    <div className="settings-body">
      <div className="settings-head">
        <div>
          <h2>{title}</h2>
          <div className="desc">{desc}</div>
        </div>
        <button className="settings-close" title="返回" onClick={onClose}>
          <ArrowLeft className="ic" />
        </button>
      </div>

      <div className="settings-content">
        <div className={`s-pane${pane === 'user' ? ' active' : ''}`}>
          <UserPane settings={settings} conversations={conversations} onChange={onChange} />
        </div>
        <div className={`s-pane${pane === 'models' ? ' active' : ''}`}>
          <ModelsPane settings={settings} onChange={onChange} />
        </div>
        <div className={`s-pane s-pane-appearance${pane === 'appearance' ? ' active' : ''}`}>
          <AppearancePane settings={settings} onChange={onChange} />
        </div>
        <div className={`s-pane${pane === 'skills' ? ' active' : ''}`}>
          <SkillsPane active={pane === 'skills'} />
        </div>
        <div className={`s-pane${pane === 'knowledge' ? ' active' : ''}`}>
          <KnowledgePane settings={settings} onChange={onChange} />
        </div>
        <div className={`s-pane${pane === 'tools' ? ' active' : ''}`}>
          <ToolsPane settings={settings} onChange={onChange} />
        </div>
        <div className={`s-pane${pane === 'connectors' ? ' active' : ''}`}>
          <ConnectorsPane />
        </div>
      </div>
    </div>
  )
}

/* ---------- 0. 用户 ---------- */

const DAY_MS = 86_400_000
const MONTH_SHORT = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

function localDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 按本地日统计用户发言 / round（一次问答算一次打卡） */
function activityByDay(conversations: Conversation[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of conversations) {
    for (const n of Object.values(c.nodes)) {
      if (n.role !== 'user' && n.role !== 'round') continue
      const key = localDayKey(n.createdAt)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
  }
  return map
}

function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

function currentStreak(byDay: Map<string, number>): number {
  const today = startOfLocalDay(Date.now())
  let cursor = today
  if (!(byDay.get(localDayKey(cursor)) ?? 0)) cursor -= DAY_MS
  let streak = 0
  while ((byDay.get(localDayKey(cursor)) ?? 0) > 0) {
    streak += 1
    cursor -= DAY_MS
  }
  return streak
}

type ContribCell =
  | { kind: 'pad'; key: string }
  | {
      kind: 'day'
      key: string
      count: number
      level: 0 | 1 | 2 | 3 | 4
      label: string
    }

type ContribMonth = {
  key: string
  label: string
  cells: ContribCell[]
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** 近 12 个自然月，按月分块（LeetCode 式，月与月之间留缝） */
function buildContribMonths(byDay: Map<string, number>): {
  months: ContribMonth[]
  total: number
  streak: number
  activeDays: number
} {
  const today = startOfLocalDay(Date.now())
  const now = new Date(today)
  const months: ContribMonth[] = []
  let total = 0
  let activeDays = 0

  for (let i = 11; i >= 0; i--) {
    const y = now.getFullYear()
    const m = now.getMonth() - i
    const anchor = new Date(y, m, 1)
    const year = anchor.getFullYear()
    const month = anchor.getMonth()
    const firstDow = new Date(year, month, 1).getDay() // 0=周日
    const dim = daysInMonth(year, month)
    const cells: ContribCell[] = []

    for (let p = 0; p < firstDow; p++) {
      cells.push({ kind: 'pad', key: `${year}-${month}-pad-${p}` })
    }

    for (let day = 1; day <= dim; day++) {
      const ts = startOfLocalDay(new Date(year, month, day).getTime())
      if (ts > today) {
        cells.push({ kind: 'pad', key: `${year}-${month}-future-${day}` })
        continue
      }
      const key = localDayKey(ts)
      const count = byDay.get(key) ?? 0
      total += count
      if (count > 0) activeDays += 1
      cells.push({
        kind: 'day',
        key,
        count,
        level: levelFor(count),
        label: `${year}年${month + 1}月${day}日 · ${count} 次对话`,
      })
    }

    months.push({
      key: `${year}-${month}`,
      label: MONTH_SHORT[month],
      cells,
    })
  }

  return { months, total, streak: currentStreak(byDay), activeDays }
}

function ActivityHeatmap({ conversations }: { conversations: Conversation[] }) {
  const { months, total, streak, activeDays } = useMemo(
    () => buildContribMonths(activityByDay(conversations)),
    [conversations],
  )

  return (
    <div className="contrib">
      <div className="contrib-head">
        <div className="contrib-head-main">
          过去一年共对话 <strong>{total.toLocaleString('zh-CN')}</strong> 次
        </div>
        <div className="contrib-head-meta">
          <span>
            累计活跃天数：<em>{activeDays}</em>
          </span>
          <span>
            连续：<em>{streak}</em>
          </span>
        </div>
      </div>
      <div
        className="contrib-months-row"
        role="img"
        aria-label={`近一年对话热力图，共 ${total} 次`}
      >
        {months.map((m) => (
          <div key={m.key} className="contrib-month">
            <div className="contrib-month-grid">
              {m.cells.map((c) =>
                c.kind === 'pad' ? (
                  <span key={c.key} className="contrib-cell is-pad" />
                ) : (
                  <span
                    key={c.key}
                    className="contrib-cell"
                    data-level={c.level}
                    title={c.label}
                  />
                ),
              )}
            </div>
            <div className="contrib-month-label">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function UserPane({
  settings,
  conversations,
  onChange,
}: {
  settings: Settings
  conversations: Conversation[]
  onChange: (s: Settings) => void
}) {
  const nickname = settings.user?.nickname ?? ''
  const letter = userAvatarLetter(settings)

  return (
    <>
      <div className="sub-label">资料</div>
      <div className="user-profile">
        <div className="avatar user-profile-avatar">{letter}</div>
        <div className="user-profile-fields">
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="field-label">昵称</div>
            <input
              type="text"
              placeholder="显示在侧栏左下角"
              value={nickname}
              maxLength={32}
              onChange={(e) =>
                onChange({
                  ...settings,
                  user: { ...settings.user, nickname: e.target.value },
                })
              }
            />
          </div>
        </div>
      </div>
      <p className="user-profile-hint">头像字标取昵称首字；暂无账号登录，仅本机使用。</p>
      <div className="sub-label">活跃度</div>
      <ActivityHeatmap conversations={conversations} />
    </>
  )
}

/* ---------- 1. 模型配置（密钥 / 端点跟随模型条目） ---------- */

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

const PROVIDER_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'anthropic', label: 'Anthropic', hint: 'claude-sonnet-4-6' },
  { value: 'openai', label: 'OpenAI', hint: 'gpt-4o' },
  // DeepSeek 官方：deepseek-flash / deepseek-v4-pro，上下文 1M
  // https://api-docs.deepseek.com/zh-cn/quick_start/pricing
  { value: 'deepseek', label: 'DeepSeek', hint: 'deepseek-flash' },
  { value: 'custom', label: '自定义', hint: 'model-id' },
]

/** 各厂默认上下文窗口（token）；DeepSeek 见官方定价页 1M */
function defaultContextFor(provider: string): number {
  if (provider === 'deepseek') return 1_000_000
  if (provider === 'anthropic') return 200_000
  return 128_000
}

function formatContext(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function ModelsPane({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('anthropic')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editModelId, setEditModelId] = useState('')
  const [editKey, setEditKey] = useState('')
  const [editBase, setEditBase] = useState('')
  const [tests, setTests] = useState<Record<string, { state: TestState; msg: string }>>({})

  const patchModel = (id: string, patch: Partial<ModelConfig>) =>
    onChange({
      ...settings,
      models: settings.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })

  const removeModel = (id: string) =>
    onChange({ ...settings, models: settings.models.filter((m) => m.id !== id) })

  const startEdit = (m: ModelConfig) => {
    setEditingId(m.id)
    setEditModelId(m.modelId)
    setEditKey(m.apiKey ?? '')
    setEditBase(m.baseURL ?? '')
  }

  const saveEdit = (id: string) => {
    const m = settings.models.find((x) => x.id === id)
    if (!m) return setEditingId(null)
    patchModel(id, {
      modelId: editModelId.trim() || m.modelId,
      apiKey: editKey,
      baseURL: editBase.trim() || undefined,
    })
    setEditingId(null)
  }

  // 测试连接：真发一次 GET /models 验证连通（deepseek 未填 key 时用 dev 预填）
  const runTest = async (m: ModelConfig) => {
    setTests((t) => ({ ...t, [m.id]: { state: 'testing', msg: '' } }))
    try {
      const ms = await testConnection(m)
      setTests((t) => ({ ...t, [m.id]: { state: 'ok', msg: ms } }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTests((t) => ({ ...t, [m.id]: { state: 'fail', msg: msg.slice(0, 60) } }))
    }
  }

  const testTag = (id: string) => {
    const t = tests[id]
    if (!t || t.state === 'idle') return null
    if (t.state === 'testing') return <span className="tag-muted">测试中…</span>
    if (t.state === 'ok') return <span className="tag-ok">已连通 · {t.msg}</span>
    return <span className="tag-fail">失败 · {t.msg}</span>
  }

  const devKey = devDeepseekKey()

  // key 粘贴带入非法字符（空格/换行/全角）时的就地警示
  const badCharWarn = (v?: string) =>
    keyHasBadChars(v) ? (
      <div className="field-warn">检测到非法字符（空格、换行或全角），请清空后重新粘贴</div>
    ) : null

  const keyTag = (m: ModelConfig) => {
    if (m.provider === 'deepseek' && devKey)
      return <span className="tag-ok">开发预填 {maskKey(devKey)} 生效中</span>
    if (m.apiKey?.trim()) return <span className="tag-muted">{maskKey(m.apiKey)}</span>
    return <span className="tag-fail">未配置密钥</span>
  }

  const canAdd = Boolean(name.trim() && modelId.trim())
  const modelHint =
    PROVIDER_OPTIONS.find((o) => o.value === provider)?.hint ?? 'model-id'

  const addModel = () => {
    if (!canAdd) return
    onChange({
      ...settings,
      models: [
        ...settings.models,
        {
          id: `m-${Date.now()}`,
          name: name.trim(),
          provider,
          modelId: modelId.trim(),
          context: defaultContextFor(provider),
          apiKey: apiKey || undefined,
          baseURL: provider === 'custom' ? baseURL.trim() || undefined : undefined,
        },
      ],
    })
    setName('')
    setModelId('')
    setApiKey('')
    setBaseURL('')
  }

  return (
    <>
      <div className="sub-label">已配置的模型</div>
      {settings.models.map((m) => (
        <div className={`row-card model-card provider-${m.provider}`} key={m.id}>
          <div className="model-card-mark" aria-hidden>
            <BrandIcon provider={m.provider} className="model-card-logo" />
          </div>
          <div className="rc-main">
            <div className="rc-title">
              <span className="model-card-badge">
                <BrandIcon provider={m.provider} className="brand-ic" />
              </span>
              {m.name} {m.isDefault && <span className="tag-default">默认</span>} {keyTag(m)}
            </div>
            {editingId === m.id ? (
              <div className="model-edit">
                <input
                  autoFocus
                  value={editModelId}
                  placeholder="模型 ID"
                  onChange={(e) => setEditModelId(e.target.value)}
                />
                <input
                  type="password"
                  value={editKey}
                  placeholder="API Key"
                  onChange={(e) => setEditKey(e.target.value)}
                />
                {m.provider === 'custom' && (
                  <input
                    value={editBase}
                    placeholder="https://api.example.com/v1"
                    onChange={(e) => setEditBase(e.target.value)}
                  />
                )}
                {badCharWarn(editKey) || badCharWarn(editBase)}
                <div className="byok-row">
                  <button className="btn btn-primary" onClick={() => saveEdit(m.id)}>
                    保存
                  </button>
                  <button className="btn" onClick={() => setEditingId(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="rc-sub">
                {m.provider} · {m.modelId} · {formatContext(m.context)} 上下文
                {m.baseURL ? ` · ${m.baseURL}` : ''}
              </div>
            )}
          </div>
          <div className="rc-actions">
            {editingId !== m.id && (
              <>
                <button
                  className="icon-btn"
                  title="测试连接"
                  disabled={tests[m.id]?.state === 'testing'}
                  onClick={() => runTest(m)}
                >
                  <Zap className="ic ic-sm" />
                </button>
                <button className="icon-btn" title="编辑" onClick={() => startEdit(m)}>
                  <Pencil className="ic ic-sm" />
                </button>
                <button className="icon-btn" title="删除" onClick={() => removeModel(m.id)}>
                  <Trash2 className="ic ic-sm" />
                </button>
                {testTag(m.id)}
              </>
            )}
          </div>
        </div>
      ))}

      <div className="sub-label">添加模型</div>
      <div className={`model-add provider-${provider}`}>
        <div className="model-card-mark" aria-hidden>
          <BrandIcon provider={provider} className="model-card-logo" />
        </div>
        <div className="model-add-inner">
          <div className="model-add-providers" role="radiogroup" aria-label="提供商">
            {PROVIDER_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={provider === o.value}
                className={`model-add-prov${provider === o.value ? ' on' : ''}`}
                onClick={() => setProvider(o.value)}
              >
                <BrandIcon provider={o.value} className="brand-ic" />
                <span>{o.label}</span>
              </button>
            ))}
          </div>

          <div className="model-add-grid">
            <label className="model-add-field">
              <span>显示名称</span>
              <input
                type="text"
                placeholder="例如：DeepSeek V4"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="model-add-field">
              <span>模型 ID</span>
              <input
                type="text"
                placeholder={modelHint}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </label>
            <label className="model-add-field model-add-span">
              <span>API Key</span>
              <input
                type="password"
                placeholder={
                  provider === 'deepseek' && devKey
                    ? '开发预填优先生效，此处可留空'
                    : 'sk-...'
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {badCharWarn(apiKey)}
            </label>
            {provider === 'custom' && (
              <label className="model-add-field model-add-span">
                <span>端点地址</span>
                <input
                  type="text"
                  placeholder="https://api.example.com/v1"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                />
                {badCharWarn(baseURL)}
              </label>
            )}
          </div>

          <div className="model-add-foot">
            <span className="model-add-hint">密钥仅存本地，不会上传</span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canAdd}
              onClick={addModel}
            >
              <Plus className="ic ic-sm" />
              添加模型
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/* ---------- 2. 外观 ---------- */

function ProductThumb({ theme, accent }: { theme: 'light' | 'dark'; accent: AccentId }) {
  return (
    <div className="ui-thumb" data-theme={theme} data-accent={accent} aria-hidden>
      <div className="ui-thumb-side">
        <div className="ui-thumb-brand" />
        <div className="ui-thumb-nav on" />
        <div className="ui-thumb-nav" />
        <div className="ui-thumb-nav" />
        <div className="ui-thumb-nav" />
        <div className="ui-thumb-side-foot">
          <span className="ui-thumb-dot accent" />
          <span className="ui-thumb-dot" />
        </div>
      </div>
      <div className="ui-thumb-main">
        <div className="ui-thumb-top">
          <span className="ui-thumb-title" />
          <span className="ui-thumb-pill" />
        </div>
        <div className="ui-thumb-chat">
          <div className="ui-thumb-msg user">
            <span />
            <span />
          </div>
          <div className="ui-thumb-msg bot">
            <span className="ui-thumb-badge" />
            <span />
            <span />
            <span className="short" />
          </div>
          <div className="ui-thumb-msg bot">
            <span />
            <span className="short" />
          </div>
        </div>
        <div className="ui-thumb-composer">
          <div className="ui-thumb-input">
            <span className="ui-thumb-chip" />
            <span className="ui-thumb-send" />
          </div>
        </div>
      </div>
      <div className="ui-thumb-panel">
        <div className="ui-thumb-ptabs">
          <span className="on" />
          <span />
          <span />
        </div>
        <div className="ui-thumb-file" />
        <div className="ui-thumb-file" />
        <div className="ui-thumb-file short" />
      </div>
    </div>
  )
}

function AppearancePane({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const accent = settings.appearance?.accent ?? 'violet'
  const setAccent = (id: AccentId) =>
    onChange({ ...settings, appearance: { ...settings.appearance, accent: id } })

  return (
    <>
      <div className="sub-label">主题色</div>
      <div className="accent-grid">
        {ACCENT_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`accent-card${accent === o.id ? ' on' : ''}`}
            onClick={() => setAccent(o.id)}
          >
            <span className="accent-swatch" style={{ background: o.swatch }} />
            <span className="accent-meta">
              <span className="accent-name">{o.label}</span>
              <span className="accent-desc">{o.desc}</span>
            </span>
            {accent === o.id && <Check className="ic ic-sm accent-check" />}
          </button>
        ))}
      </div>
      <div className="sub-label">预览</div>
      <div className="ui-thumb-row">
        <div className="ui-thumb-wrap">
          <ProductThumb theme="light" accent={accent} />
          <span className="ui-thumb-caption">浅色</span>
        </div>
        <div className="ui-thumb-wrap">
          <ProductThumb theme="dark" accent={accent} />
          <span className="ui-thumb-caption">深色</span>
        </div>
      </div>
    </>
  )
}

/* ---------- 3. 技能 ---------- */

function SkillsPane({ active }: { active: boolean }) {
  const [items, setItems] = useState<SkillSummary[]>([])
  const [root, setRoot] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const available = skillsAvailable()

  const reload = async () => {
    if (!available) return
    setLoading(true)
    setError(null)
    try {
      const [list, r] = await Promise.all([listSkills(), skillsRoot()])
      setItems(list)
      setRoot(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (active) void reload()
  }, [active, available])

  const onCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createSkill({ name: name.trim(), description: desc.trim() || undefined })
      setName('')
      setDesc('')
      await reload()
      void syncSkillsIntoHarness()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = async (id: string) => {
    setError(null)
    try {
      const detail = await readSkill(id)
      if (!detail) return
      setEditingId(id)
      setDraft(detail.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      await writeSkill(editingId, draft)
      setEditingId(null)
      setDraft('')
      await reload()
      void syncSkillsIntoHarness()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (id: string) => {
    if (!confirm(`删除技能「${id}」？此操作不可恢复。`)) return
    setError(null)
    try {
      await deleteSkill(id)
      if (editingId === id) {
        setEditingId(null)
        setDraft('')
      }
      await reload()
      void syncSkillsIntoHarness()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!available) {
    return (
      <>
        <div className="sub-label">本地技能</div>
        <p className="user-profile-hint">技能目录需要桌面端（默认 `.yagent/skills/`）。浏览器环境暂不可用。</p>
      </>
    )
  }

  return (
    <>
      <div className="sub-label">存储位置</div>
      <div className="skill-root">{root ?? '…'}</div>

      <div className="sub-label">已安装</div>
      {loading && <div className="skill-empty">加载中…</div>}
      {!loading && items.length === 0 && (
        <div className="skill-empty">还没有技能。每个技能是一个含 SKILL.md 的文件夹。</div>
      )}
      {items.map((s) => (
        <div className="skill-card" key={s.id}>
          <div className="skill-card-main">
            <div className="skill-card-title">
              {s.name}
              {s.disableModelInvocation ? (
                <span className="skill-badge" title="仅显式调用；不进模型自动目录">
                  手动
                </span>
              ) : null}
            </div>
            <div className="skill-card-desc">{s.description || s.id}</div>
          </div>
          <div className="skill-card-actions">
            <button
              type="button"
              className="icon-btn"
              title="编辑"
              onClick={() => void startEdit(s.id)}
            >
              <Pencil className="ic ic-sm" />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="删除"
              onClick={() => void onDelete(s.id)}
            >
              <Trash2 className="ic ic-sm" />
            </button>
          </div>
        </div>
      ))}

      {editingId && (
        <>
          <div className="sub-label">编辑 {editingId}/SKILL.md</div>
          <textarea
            className="skill-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="byok-row">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveEdit()}>
              保存
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditingId(null)
                setDraft('')
              }}
            >
              取消
            </button>
          </div>
        </>
      )}

      <div className="sub-label">新建技能</div>
      <div className="field">
        <div className="field-label">名称</div>
        <input
          type="text"
          placeholder="例如：code-review"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <div className="field-label">描述</div>
        <input
          type="text"
          placeholder="何时触发、做什么"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={saving || !name.trim()}
        onClick={() => void onCreate()}
      >
        <Plus className="ic ic-sm" />
        创建技能
      </button>

      {error && <div className="field-warn">{error}</div>}
    </>
  )
}

/* ---------- 4. 知识库 ---------- */

const KB_PROVIDERS: {
  kind: Exclude<KnowledgeSourceKind, 'local'>
  name: string
  desc: string
  icon: typeof BookOpen
  color: string
}[] = [
  { kind: 'notion', name: 'Notion', desc: '页面与数据库作检索源', icon: BookOpen, color: '#000000' },
  {
    kind: 'gdrive',
    name: 'Google Drive',
    desc: '云盘文档与表格',
    icon: HardDrive,
    color: '#1fa463',
  },
  { kind: 'feishu', name: '飞书文档', desc: '知识库与云文档', icon: Layers, color: '#3370ff' },
  {
    kind: 'confluence',
    name: 'Confluence',
    desc: '团队 Wiki 空间',
    icon: BookOpen,
    color: '#172b4d',
  },
  { kind: 'web', name: '网站 / Sitemap', desc: '按 URL 抓取并索引', icon: Globe, color: '#6c5ce7' },
]

function KnowledgePane({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const sources = settings.knowledgeBases?.sources ?? []
  const setSources = (next: KnowledgeSource[]) =>
    onChange({ ...settings, knowledgeBases: { sources: next } })

  const connectedKinds = new Set(sources.map((s) => s.kind))

  const connectLocal = async () => {
    const dir = await window.yagentDesktop?.dialog?.selectDirectory?.()
    if (!dir) return
    if (sources.some((s) => s.kind === 'local' && s.target === dir)) return
    const name = dir.split(/[/\\]/).filter(Boolean).pop() || dir
    setSources([
      ...sources,
      {
        id: `kb-local-${Date.now()}`,
        kind: 'local',
        name,
        target: dir,
        connectedAt: Date.now(),
      },
    ])
  }

  const connectProvider = (kind: Exclude<KnowledgeSourceKind, 'local'>, name: string) => {
    if (sources.some((s) => s.kind === kind)) return
    setSources([
      ...sources,
      {
        id: `kb-${kind}-${Date.now()}`,
        kind,
        name,
        connectedAt: Date.now(),
      },
    ])
  }

  const disconnect = (id: string) => setSources(sources.filter((s) => s.id !== id))

  const kindLabel = (kind: KnowledgeSourceKind) => {
    if (kind === 'local') return '本地目录'
    return KB_PROVIDERS.find((p) => p.kind === kind)?.name ?? kind
  }

  return (
    <>
      <div className="sub-label">已连接</div>
      {sources.length === 0 && (
        <div className="skill-empty">尚未连接知识源。可添加本地目录，或连接下方服务。</div>
      )}
      {sources.map((s) => (
        <div className="row-card" key={s.id}>
          <span className="file-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
            {s.kind === 'local' ? (
              <FolderOpen className="ic ic-sm" />
            ) : (
              <BookOpen className="ic ic-sm" />
            )}
          </span>
          <div className="rc-main">
            <div className="rc-title">
              {s.name} <span className="tag-ok">已连接</span>
            </div>
            <div className="rc-sub">
              {kindLabel(s.kind)}
              {s.target ? ` · ${s.target}` : ''}
            </div>
          </div>
          <div className="rc-actions">
            <button type="button" className="btn" onClick={() => disconnect(s.id)}>
              断开
            </button>
          </div>
        </div>
      ))}

      <div className="sub-label">本地</div>
      <button
        type="button"
        className="btn"
        disabled={!window.yagentDesktop?.dialog?.selectDirectory}
        onClick={() => void connectLocal()}
      >
        <FolderOpen className="ic ic-sm" />
        连接本地目录
      </button>
      {!window.yagentDesktop?.dialog?.selectDirectory && (
        <p className="user-profile-hint">选择本地目录需要桌面端。</p>
      )}

      <div className="sub-label">云端与其它</div>
      {KB_PROVIDERS.map((p) => {
        const Icon = p.icon
        const on = connectedKinds.has(p.kind)
        return (
          <div className="row-card" key={p.kind}>
            <span className="file-badge" style={{ background: p.color, color: '#fff' }}>
              <Icon className="ic ic-sm" />
            </span>
            <div className="rc-main">
              <div className="rc-title">
                {p.name} {on && <span className="tag-ok">已连接</span>}
              </div>
              <div className="rc-sub">{p.desc}</div>
            </div>
            <div className="rc-actions">
              <button
                type="button"
                className="btn"
                disabled={on}
                onClick={() => connectProvider(p.kind, p.name)}
              >
                {on ? '已连接' : '连接'}
              </button>
            </div>
          </div>
        )
      })}

      <div className="files-note" style={{ marginTop: 16 }}>
        连接状态会写入本地设置。检索工具、向量索引与 OAuth/MCP 拉取尚未实现；当前先完成来源登记。
      </div>
    </>
  )
}

/* ---------- 5. 工具 ---------- */

function ToolsPane({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const toggleTool = (key: 'terminal' | 'fileEdit' | 'webSearch' | 'autoApprove') =>
    onChange({ ...settings, tools: { ...settings.tools, [key]: !settings.tools[key] } })

  const webProvider = settings.tools.webProvider ?? 'bing'
  // 语音输入暂关
  // const asr = settings.tools.asr ?? {}
  // const asrProvider = asr.provider ?? 'groq'
  // const setAsr = (patch: NonNullable<Settings['tools']['asr']>) =>
  //   onChange({
  //     ...settings,
  //     tools: { ...settings.tools, asr: { ...asr, ...patch } },
  //   })

  return (
    <>
      <div className="sub-label">默认工具</div>
      <div className="switch-row">
        <span className="sr-text">
          终端命令<small>允许 Agent 执行 shell 命令</small>
        </span>
        <button
          className={`switch${settings.tools.terminal ? ' on' : ''}`}
          onClick={() => toggleTool('terminal')}
        ></button>
      </div>
      <div className="switch-row">
        <span className="sr-text">
          文件编辑<small>允许直接修改工作区文件</small>
        </span>
        <button
          className={`switch${settings.tools.fileEdit ? ' on' : ''}`}
          onClick={() => toggleTool('fileEdit')}
        ></button>
      </div>
      <div className="switch-row">
        <span className="sr-text">
          网络搜索<small>允许访问互联网获取资料</small>
        </span>
        <button
          className={`switch${settings.tools.webSearch ? ' on' : ''}`}
          onClick={() => toggleTool('webSearch')}
        ></button>
      </div>

      <div className="sub-label">网络内容后端</div>
      <div className="field">
        <div className="field-label">search_web / fetch_url</div>
        <div className="segmented">
          <button
            className={webProvider === 'bing' ? 'on' : ''}
            onClick={() =>
              onChange({ ...settings, tools: { ...settings.tools, webProvider: 'bing' } })
            }
          >
            Bing
          </button>
          <button
            className={webProvider === 'deepseek' ? 'on' : ''}
            onClick={() =>
              onChange({ ...settings, tools: { ...settings.tools, webProvider: 'deepseek' } })
            }
          >
            DeepSeek
          </button>
        </div>
        <div className="field-label" style={{ marginTop: 8 }}>
          <span className="hint">
            {webProvider === 'deepseek'
              ? 'DeepSeek 官方 Search/Fetch API；密钥复用「模型配置」里的 DeepSeek API Key'
              : '抓取 Bing 结果页 + 直连 URL 去标签（免费，解析可能不稳定）'}
          </span>
        </div>
      </div>

      {/* 语音输入暂关：ASR 设置
      <div className="sub-label">语音识别（ASR）</div>
      ...
      */}

      <div className="sub-label">沙箱</div>
      <div className="field">
        <div className="field-label">执行环境</div>
        <div className="segmented">
          <button
            className={settings.sandbox.env === 'local' ? 'on' : ''}
            onClick={() =>
              onChange({ ...settings, sandbox: { ...settings.sandbox, env: 'local' } })
            }
          >
            本地直连
          </button>
          <button
            className={settings.sandbox.env === 'sandbox' ? 'on' : ''}
            onClick={() =>
              onChange({ ...settings, sandbox: { ...settings.sandbox, env: 'sandbox' } })
            }
          >
            隔离沙箱
          </button>
        </div>
      </div>
      <div className="field">
        <div className="field-label">工作目录</div>
        <input
          type="text"
          value={settings.sandbox.workdir}
          onChange={(e) =>
            onChange({ ...settings, sandbox: { ...settings.sandbox, workdir: e.target.value } })
          }
        />
      </div>
      <div className="switch-row">
        <span className="sr-text">沙箱内允许网络访问</span>
        <button
          className={`switch${settings.sandbox.network ? ' on' : ''}`}
          onClick={() =>
            onChange({
              ...settings,
              sandbox: { ...settings.sandbox, network: !settings.sandbox.network },
            })
          }
        ></button>
      </div>
    </>
  )
}


/* ---------- 3. 连接器（外部服务，Claude Connectors 风格） ---------- */

interface ConnectorDef {
  id: string
  name: string
  desc: string
  icon: typeof Code2
  color: string // 品牌色徽章
}

const CONNECTORS: ConnectorDef[] = [
  { id: 'github', name: 'GitHub', desc: '读写仓库、Issue 与 Pull Request', icon: Code2, color: '#24292f' },
  { id: 'notion', name: 'Notion', desc: '检索和更新文档、知识库', icon: BookOpen, color: '#000000' },
  { id: 'gdrive', name: 'Google Drive', desc: '读取云盘文件与表格', icon: HardDrive, color: '#1fa463' },
  { id: 'figma', name: 'Figma', desc: '读取设计稿与组件信息', icon: PenTool, color: '#a259ff' },
  { id: 'slack', name: 'Slack', desc: '检索消息、发送通知', icon: Hash, color: '#e01e5a' },
  { id: 'linear', name: 'Linear', desc: '查询和更新问题单', icon: Layers, color: '#5e6ad2' },
]

/** 连接器：本期仅 UI 演示，连接状态存本地 state，未接真实 OAuth/MCP */
function ConnectorsPane() {
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setConnected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <div className="sub-label">可用服务</div>
      {CONNECTORS.map((c) => {
        const Icon = c.icon
        const on = connected.has(c.id)
        return (
          <div className="row-card" key={c.id}>
            <span className="file-badge" style={{ background: c.color, color: '#fff' }}>
              <Icon className="ic ic-sm" />
            </span>
            <div className="rc-main">
              <div className="rc-title">
                {c.name} {on && <span className="tag-ok">已连接</span>}
              </div>
              <div className="rc-sub">{c.desc}</div>
            </div>
            <div className="rc-actions">
              <button className="btn" onClick={() => toggle(c.id)}>
                {on ? '断开' : '连接'}
              </button>
            </div>
          </div>
        )
      })}

      <div className="sub-label">自定义 MCP 服务器</div>
      <div className="field">
        <div className="field-label">
          服务器地址 <span className="hint">stdio / SSE / HTTP</span>
        </div>
        <input type="text" placeholder="https://mcp.example.com/sse" disabled />
      </div>
      <button className="btn" disabled>
        <Plus className="ic ic-sm" />
        添加（即将支持）
      </button>

      <div className="files-note" style={{ marginTop: 16 }}>
        连接器为预览功能：连接状态仅本地演示，真实授权（OAuth）与 MCP 接入尚未实现。
      </div>
    </>
  )
}

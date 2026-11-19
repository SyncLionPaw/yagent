import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent,
} from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Globe,
  HardDrive,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type {
  AccentId,
  Conversation,
  Insight,
  KnowledgeSource,
  KnowledgeSourceKind,
  ModelConfig,
  SendKey,
  Settings,
  UiSkin,
} from '@yagent/core'
import { categoryMatches, listSightInsights } from '../insights'
import { BrandIcon } from './BrandIcons'
import { UserAvatar } from './UserAvatar'
import {
  devDeepseekKey,
  keyHasBadChars,
  maskKey,
  testConnection,
} from '../harness'
import {
  TOKEN_RANGES,
  bucketEvents,
  estimateEventsFromConversations,
  formatBucketLabel,
  formatTok,
  loadTokenUsage,
  sumEvents,
  type TokenRangeId,
  type UsageEvent,
} from '../tokenUsage'

import {
  userAvatarLetter,
  type SettingsPaneId,
} from '../settingsMeta'
import { ConnectorsPane } from './settings/ConnectorsPane'
import { StoragePane } from './settings/StoragePane'
import { SkillsPane } from './settings/SkillsPane'

export type { SettingsPaneId } from '../settingsMeta'
export { userNickname, userAvatarLetter } from '../settingsMeta'

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
  appearance: ['外观', '界面皮肤与主题强调色会应用到全局样式'],
  skills: ['技能', '管理 SKILL.md；可扫描 Cursor / Claude 等目录并迁移'],
  inspiration: ['灵感', '关闭时不提取收获；开启后可配置关键词引导方向'],
  knowledge: ['知识库', '连接本地目录或云端文档源，供 Agent 检索引用'],
  tools: ['工具', '配置 Agent 的默认工具与沙箱'],
  connectors: ['连接器', '连接外部服务，让 Agent 读写你的工具和数据'],
  storage: ['存储空间', '查看应用数据目录占用，以及各子目录体积'],
}

const ACCENT_OPTIONS: { id: AccentId; label: string; desc: string; swatch: string }[] = [
  { id: 'violet', label: '紫罗兰', desc: '默认强调色', swatch: '#6c5ce7' },
  { id: 'frost-green', label: '磨砂绿', desc: '青调抹茶', swatch: '#1faa6e' },
  { id: 'summer-orange', label: '盛夏橙', desc: '热烈夏日', swatch: '#e07a3a' },
  { id: 'ice-blue', label: '冰晶蓝', desc: '清冽冰蓝', swatch: '#3d8fd1' },
  { id: 'sakura-pink', label: '初樱粉', desc: '淡樱初放', swatch: '#e08aa4' },
  { id: 'maple-red', label: '枫红', desc: '秋枫鲜红', swatch: '#d63b3b' },
]

const SKIN_OPTIONS: { id: UiSkin; label: string; desc: string }[] = [
  { id: 'default', label: '默认', desc: '实色面板' },
  { id: 'liquid-glass', label: '液态玻璃', desc: '测试主题 · 重磨砂' },
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
        {/* 仍用 CSS .active 显隐：保证翻面瞬间内容已在树里，避免卸载/lazy 首帧空白 */}
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
        <div className={`s-pane s-pane-inspiration${pane === 'inspiration' ? ' active' : ''}`}>
          <InspirationPane active={pane === 'inspiration'} settings={settings} onChange={onChange} />
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
        <div className={`s-pane${pane === 'storage' ? ' active' : ''}`}>
          <StoragePane active={pane === 'storage'} />
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

function TokenRangeMenu({
  value,
  onChange,
}: {
  value: TokenRangeId
  onChange: (id: TokenRangeId) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = TOKEN_RANGES.find((r) => r.id === value) ?? TOKEN_RANGES[0]!

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`token-range${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="token-range-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current.label}</span>
        <ChevronDown className="ic ic-sm token-range-chevron" />
      </button>
      {open && (
        <ul className="token-range-menu" role="listbox" aria-label="时间范围">
          {TOKEN_RANGES.map((r) => (
            <li key={r.id} role="option" aria-selected={r.id === value}>
              <button
                type="button"
                className={`token-range-option${r.id === value ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(r.id)
                  setOpen(false)
                }}
              >
                {r.label}
                {r.id === value ? <Check className="ic ic-sm" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TokenUsageCharts({ conversations }: { conversations: Conversation[] }) {
  const [apiEvents, setApiEvents] = useState<UsageEvent[] | null>(null)
  const [rangeId, setRangeId] = useState<TokenRangeId>('7d')
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void loadTokenUsage().then((store) => {
      if (alive) setApiEvents(store.events)
    })
    return () => {
      alive = false
    }
  }, [conversations])

  const { events, source } = useMemo(() => {
    const api = apiEvents ?? []
    if (sumEvents(api).input + sumEvents(api).output > 0) {
      return { events: api, source: 'api' as const }
    }
    return { events: estimateEventsFromConversations(conversations), source: 'estimate' as const }
  }, [apiEvents, conversations])

  const range = TOKEN_RANGES.find((r) => r.id === rangeId) ?? TOKEN_RANGES[3]!
  const series = useMemo(() => bucketEvents(events, range), [events, range])
  const totals = useMemo(() => sumEvents(series), [series])
  const allTime = useMemo(() => sumEvents(events), [events])

  const W = 640
  const H = 200
  const pad = { t: 12, r: 4, b: 8, l: 4 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const baseline = pad.t + plotH
  const maxY = Math.max(
    1,
    ...series.map((d) => d.input + d.output),
  )
  const barCount = Math.max(1, series.length)
  // 1 小时桶在 7 天约 168 根：缝隙随密度收紧
  const gap = barCount > 200 ? 0.25 : barCount > 80 ? 0.5 : barCount > 24 ? 1 : 1.5
  const slot = plotW / barCount
  const barW = Math.max(1, slot - gap)
  const bars = series.map((d, i) => {
    const x = pad.l + i * slot + (slot - barW) / 2
    const hIn = (d.input / maxY) * plotH
    const hOut = (d.output / maxY) * plotH
    const yOut = baseline - hIn - hOut
    const yIn = baseline - hIn
    return { ...d, i, x, barW, hIn, hOut, yIn, yOut }
  })
  const xLabels = useMemo(() => {
    const want = rangeId === '1h' ? 5 : rangeId === '12h' ? 6 : 7
    const step = Math.max(1, Math.floor((series.length - 1) / Math.max(1, want - 1)))
    const idxs = new Set<number>()
    for (let i = 0; i < series.length; i += step) idxs.add(i)
    if (series.length) idxs.add(series.length - 1)
    return [...idxs].sort((a, b) => a - b)
  }, [series, rangeId])

  const ringTotal = Math.max(1, allTime.input + allTime.output)
  const inputPct = allTime.input / ringTotal
  const r = 54
  const circ = 2 * Math.PI * r
  const inputLen = inputPct * circ
  const outputLen = (allTime.output / ringTotal) * circ
  const hovered = hover != null ? series[hover] : null

  return (
    <div className="token-usage-stack">
      <div className="token-card">
        <div className="token-card-head">
          <div className="token-card-titles">
            <div className="token-card-title">Token 用量</div>
            <div className="token-card-sub">
              {range.label}合计 {formatTok(totals.input + totals.output)} ·{' '}
              {source === 'api' ? 'API 计量' : '按对话内容估算'}
            </div>
          </div>
          <TokenRangeMenu
            value={rangeId}
            onChange={(id) => {
              setRangeId(id)
              setHover(null)
            }}
          />
        </div>

        <div
          className="token-area-wrap"
          role="img"
          aria-label={`${range.label}输入与输出 token 柱状图`}
        >
          <svg
            className="token-area-svg"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
          >
            {bars.map((b) => (
              <g
                key={b.key}
                className={`token-bar${hover === b.i ? ' is-hot' : ''}${hover != null && hover !== b.i ? ' is-dim' : ''}`}
                onMouseEnter={() => setHover(b.i)}
              >
                {/* 透明热区，空柱也可悬停 */}
                <rect
                  className="token-bar-hit"
                  x={b.x}
                  y={pad.t}
                  width={b.barW}
                  height={plotH}
                />
                {b.hIn > 0 ? (
                  <rect
                    className="token-bar-seg is-in"
                    x={b.x}
                    y={b.yIn}
                    width={b.barW}
                    height={Math.max(b.hIn, 0.5)}
                    rx={Math.min(1.5, b.barW / 2)}
                  />
                ) : null}
                {b.hOut > 0 ? (
                  <rect
                    className="token-bar-seg is-out"
                    x={b.x}
                    y={b.yOut}
                    width={b.barW}
                    height={Math.max(b.hOut, 0.5)}
                    rx={Math.min(1.5, b.barW / 2)}
                  />
                ) : null}
              </g>
            ))}
          </svg>
          <div className="token-area-xlabels" aria-hidden="true">
            {xLabels.map((i) => {
              const d = series[i]
              if (!d) return null
              const left = ((pad.l + (i + 0.5) * slot) / W) * 100
              return (
                <span key={d.key} style={{ left: `${left}%` }}>
                  {formatBucketLabel(d.t, rangeId)}
                </span>
              )
            })}
          </div>
          {hovered && (
            <div className="token-area-tip">
              <strong>{formatBucketLabel(hovered.t, rangeId)}</strong>
              <span>输入 {formatTok(hovered.input)}</span>
              <span>输出 {formatTok(hovered.output)}</span>
              <span>合计 {formatTok(hovered.input + hovered.output)}</span>
            </div>
          )}
        </div>

        <div className="token-card-legend">
          <span className="token-legend-item">
            <i className="token-swatch is-in" />
            输入
          </span>
          <span className="token-legend-item">
            <i className="token-swatch is-out" />
            输出
          </span>
        </div>
      </div>

      <div className="token-card">
        <div className="token-card-head">
          <div className="token-card-titles">
            <div className="token-card-title">输入 / 输出构成</div>
            <div className="token-card-sub">
              累计 {formatTok(allTime.input + allTime.output)} tokens
            </div>
          </div>
        </div>
        <div className="token-pie-wrap" role="img" aria-label="输入与输出 token 占比">
          <svg className="token-pie" viewBox="0 0 160 160" aria-hidden="true">
            <circle className="token-pie-track" cx="80" cy="80" r={r} />
            <circle
              className="token-pie-seg is-in"
              cx="80"
              cy="80"
              r={r}
              strokeDasharray={`${inputLen} ${circ - inputLen}`}
              strokeDashoffset={circ * 0.25}
            />
            <circle
              className="token-pie-seg is-out"
              cx="80"
              cy="80"
              r={r}
              strokeDasharray={`${outputLen} ${circ - outputLen}`}
              strokeDashoffset={circ * 0.25 - inputLen}
            />
            <text className="token-pie-value" x="80" y="76" textAnchor="middle">
              {formatTok(allTime.input + allTime.output)}
            </text>
            <text className="token-pie-sub" x="80" y="94" textAnchor="middle">
              合计
            </text>
          </svg>
          <div className="token-pie-legend">
            <div className="token-legend-item">
              <i className="token-swatch is-in" />
              <span>输入</span>
              <strong>{formatTok(allTime.input)}</strong>
              <em>{Math.round(inputPct * 100)}%</em>
            </div>
            <div className="token-legend-item">
              <i className="token-swatch is-out" />
              <span>输出</span>
              <strong>{formatTok(allTime.output)}</strong>
              <em>{Math.round((allTime.output / ringTotal) * 100)}%</em>
            </div>
          </div>
        </div>
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
        <UserAvatar letter={letter} className="user-profile-avatar" />
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
      <p className="user-profile-hint">默认头像为 Chiikawa 小八；暂无账号登录，仅本机使用。</p>
      <div className="sub-label">活跃度</div>
      <ActivityHeatmap conversations={conversations} />
      <div className="sub-label">Token 使用</div>
      <TokenUsageCharts conversations={conversations} />
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

function ProductThumb({
  theme,
  accent,
  skin = 'default',
}: {
  theme: 'light' | 'dark'
  accent: AccentId
  skin?: UiSkin
}) {
  return (
    <div
      className={`ui-thumb${skin === 'liquid-glass' ? ' ui-thumb-glass' : ''}`}
      data-theme={theme}
      data-accent={accent}
      data-skin={skin}
      aria-hidden
    >
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
  const skin: UiSkin = settings.appearance?.skin ?? 'default'
  const sendKey: SendKey = settings.appearance?.sendKey ?? 'cmdEnter'
  const mod = /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac')
    ? '⌘'
    : 'Ctrl'
  const setAccent = (id: AccentId) =>
    onChange({ ...settings, appearance: { ...settings.appearance, accent: id } })
  const setSkin = (id: UiSkin) =>
    onChange({ ...settings, appearance: { ...settings.appearance, skin: id } })
  const setSendKey = (id: SendKey) =>
    onChange({ ...settings, appearance: { ...settings.appearance, sendKey: id } })

  return (
    <>
      <div className="sub-label">界面皮肤</div>
      <div className="accent-grid skin-grid">
        {SKIN_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`accent-card skin-card${skin === o.id ? ' on' : ''}${o.id === 'liquid-glass' ? ' skin-liquid' : ''}`}
            onClick={() => setSkin(o.id)}
          >
            <span className={`skin-preview${o.id === 'liquid-glass' ? ' liquid' : ''}`} aria-hidden />
            <span className="accent-meta">
              <span className="accent-name">{o.label}</span>
              <span className="accent-desc">{o.desc}</span>
            </span>
            {skin === o.id && <Check className="ic ic-sm accent-check" />}
          </button>
        ))}
      </div>

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

      <div className="sub-label">发送快捷键</div>
      <div className="field">
        <div className="segmented">
          <button
            type="button"
            className={sendKey === 'enter' ? 'on' : ''}
            onClick={() => setSendKey('enter')}
          >
            Enter 发送
          </button>
          <button
            type="button"
            className={sendKey === 'cmdEnter' ? 'on' : ''}
            onClick={() => setSendKey('cmdEnter')}
          >
            {mod}+Enter 发送
          </button>
        </div>
        <div className="field-label" style={{ marginTop: 8 }}>
          <span className="hint">
            {sendKey === 'enter'
              ? `Enter 发送，${mod}+Enter 换行`
              : `${mod}+Enter 发送，Enter 换行`}
          </span>
        </div>
      </div>

      <div className="sub-label">预览</div>
      <div className="ui-thumb-row">
        <div className="ui-thumb-wrap">
          <ProductThumb theme="light" accent={accent} skin={skin} />
          <span className="ui-thumb-caption">浅色</span>
        </div>
        <div className="ui-thumb-wrap">
          <ProductThumb theme="dark" accent={accent} skin={skin} />
          <span className="ui-thumb-caption">深色</span>
        </div>
      </div>
    </>
  )
}

/* ---------- 3. 技能 ---------- */

function keywordTone(k: string): number {
  let h = 2166136261
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (Math.abs(h) % 6) + 1
}

/** 灵感关键词轮播：视口内同时展示的卡片数 */
const INSP_PAGE = 4
const INSP_WHEEL_THRESHOLD = 48
const INSP_DRAG_THRESHOLD = 56

function InspBadgePreview({
  title,
  text,
  keyword,
  onClose,
}: {
  title: string
  text: string
  keyword: string
  onClose: () => void
}) {
  const rot = useRef({ x: 20, y: -8 })
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const paint = () => {
    const el = cardRef.current
    if (!el) return
    el.style.transform = `rotateX(${rot.current.x}deg) rotateY(${rot.current.y}deg)`
  }

  useEffect(() => {
    paint()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    drag.current = { px: e.clientX, py: e.clientY, x: rot.current.x, y: rot.current.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    rot.current = {
      x: d.x - (e.clientY - d.py) * 0.55,
      y: d.y + (e.clientX - d.px) * 0.55,
    }
    paint()
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div className="insp-badge" role="dialog" aria-modal="true" aria-label={title}>
      <div className="img-lightbox-bar">
        <span className="img-lightbox-cap">{keyword}</span>
        <button type="button" className="icon-btn img-lb-btn" title="关闭" onClick={onClose}>
          <X className="ic ic-sm" />
        </button>
      </div>
      <div className="insp-badge-stage" onClick={onClose}>
        <div
          className="insp-badge-spin"
          ref={cardRef}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="insp-badge-ply" aria-hidden="true" />
          <i className="insp-badge-edge t" aria-hidden="true" />
          <i className="insp-badge-edge r" aria-hidden="true" />
          <i className="insp-badge-edge b" aria-hidden="true" />
          <i className="insp-badge-edge l" aria-hidden="true" />
          <div className="insp-badge-card">
            <h3 className="insp-badge-title">{title}</h3>
            <div className="insp-badge-perf" aria-hidden="true" />
            <p className="insp-badge-text">{text}</p>
          </div>
        </div>
      </div>
      <div className="img-lightbox-hint">拖动旋转</div>
    </div>
  )
}

function InspirationPane({
  active,
  settings,
  onChange,
}: {
  active: boolean
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const enabled = settings.inspiration?.enabled === true
  const keywords = settings.inspiration?.keywords ?? []
  const [draft, setDraft] = useState('')
  const [sight, setSight] = useState<Insight[]>([])
  const [preview, setPreview] = useState<{ ins: Insight; keyword: string } | null>(null)
  const [start, setStart] = useState(0)
  const [snap, setSnap] = useState(false)
  const animating = useRef(false)
  const wheelAcc = useRef(0)
  const drag = useRef<{ pointerId: number; origin: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const carousel = keywords.length > INSP_PAGE
  const n = keywords.length
  const carouselRef = useRef(carousel)
  const nRef = useRef(n)
  const startRef = useRef(start)
  carouselRef.current = carousel
  nRef.current = n
  startRef.current = start

  const strip = useMemo(() => {
    if (!keywords.length) return [] as { k: string; ki: number; copy: number }[]
    if (!carousel) return keywords.map((k, ki) => ({ k, ki, copy: 0 }))
    return [0, 1].flatMap((copy) => keywords.map((k, ki) => ({ k, ki, copy })))
  }, [keywords, carousel])

  useEffect(() => {
    if (!active || !enabled) return
    let alive = true
    void listSightInsights().then((list) => {
      if (alive) setSight(list)
    })
    return () => {
      alive = false
    }
  }, [active, keywords, enabled])

  useEffect(() => {
    animating.current = false
    wheelAcc.current = 0
    setSnap(false)
    if (!n) {
      setStart(0)
      return
    }
    setStart((s) => ((s % n) + n) % n)
  }, [n])

  const step = (dir: -1 | 1) => {
    if (!carouselRef.current || animating.current) return false
    const len = nRef.current
    if (len <= INSP_PAGE) return false
    animating.current = true

    if (dir < 0 && startRef.current === 0) {
      // 无缝绕到副本尾部，再滑到最后一个
      setSnap(true)
      setStart(len)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSnap(false)
          setStart(len - 1)
        })
      })
      return true
    }

    setSnap(false)
    setStart((s) => s + dir)
    return true
  }

  useEffect(() => {
    if (!carousel || !active) return
    const el = viewportRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      const dx = e.deltaX
      const dy = e.deltaY
      // 触控板横滑：以横向为主；Shift+滚轮也当横滑
      const horizontal =
        Math.abs(dx) > Math.abs(dy) || (e.shiftKey && Math.abs(dy) > 0)
      if (!horizontal) return
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy
      if (Math.abs(delta) < 1) return
      e.preventDefault()
      if (animating.current) return
      wheelAcc.current += delta
      if (wheelAcc.current >= INSP_WHEEL_THRESHOLD) {
        wheelAcc.current = 0
        step(1)
      } else if (wheelAcc.current <= -INSP_WHEEL_THRESHOLD) {
        wheelAcc.current = 0
        step(-1)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [carousel, active])

  const setInspiration = (patch: { enabled?: boolean; keywords?: string[] }) => {
    onChange({
      ...settings,
      inspiration: {
        enabled: patch.enabled ?? enabled,
        keywords: patch.keywords ?? keywords,
      },
    })
  }

  const commitKeywords = (next: string[]) => {
    const cleaned = next.map((k) => k.trim()).filter(Boolean)
    const seen = new Set<string>()
    const unique: string[] = []
    for (const k of cleaned) {
      const key = k.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(k)
    }
    setInspiration({ keywords: unique })
  }

  const addDraft = () => {
    const parts = draft
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) return
    commitKeywords([...keywords, ...parts])
    setDraft('')
  }

  const onTrackTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.propertyName !== 'transform') return
    const len = nRef.current
    const s = startRef.current
    if (s >= len) {
      setSnap(true)
      setStart(s - len)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSnap(false)
          animating.current = false
        })
      })
      return
    }
    animating.current = false
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!carousel || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { pointerId: e.pointerId, origin: e.clientX }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId || animating.current) return
    const dx = e.clientX - d.origin
    if (dx >= INSP_DRAG_THRESHOLD) {
      d.origin = e.clientX
      step(-1)
    } else if (dx <= -INSP_DRAG_THRESHOLD) {
      d.origin = e.clientX
      step(1)
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div className="insp-pane">
      <div className="switch-row">
        <span className="sr-text">
          启用灵感<small>开启后 Agent 可写入收获，右栏显示收获与收藏便签</small>
        </span>
        <button
          type="button"
          className={`switch${enabled ? ' on' : ''}`}
          aria-pressed={enabled}
          onClick={() => setInspiration({ enabled: !enabled })}
        />
      </div>
      {!enabled ? (
        <div className="files-note" style={{ marginTop: 10 }}>
          灵感已关闭。开启后可配置关键词，并出现「收获」面板。
        </div>
      ) : (
      <>
      <div className={`insp-carousel${carousel ? ' peek' : ''}`}>
        {carousel ? (
          <button
            type="button"
            className="insp-nav prev"
            aria-label="上一个关键词"
            onClick={() => step(-1)}
          >
            <ChevronLeft className="ic" />
          </button>
        ) : null}
        <div
          className="insp-viewport"
          ref={viewportRef}
          aria-label="灵感槽位"
          onPointerDown={carousel ? onPointerDown : undefined}
          onPointerMove={carousel ? onPointerMove : undefined}
          onPointerUp={carousel ? onPointerUp : undefined}
          onPointerCancel={carousel ? onPointerUp : undefined}
        >
          {!keywords.length ? (
            <div className="insp-wall-empty">添加关键词后会出现竖向槽位</div>
          ) : (
            <div
              className={`insp-track${carousel ? '' : ' static'}${snap ? ' snap' : ''}`}
              style={
                carousel
                  ? ({ ['--start' as string]: start } as CSSProperties)
                  : undefined
              }
              onTransitionEnd={carousel ? onTrackTransitionEnd : undefined}
            >
              {strip.map(({ k, ki, copy }) => {
                const cards = sight.filter((ins) => categoryMatches(ins.category, k))
                const stack = cards.slice(0, 10)
                const tone = keywordTone(k)
                return (
                  <section className={`insp-folder tone-${tone}`} key={`${copy}-${ki}-${k}`}>
                    <div className="insp-folder-tab">
                      <h3 className="insp-folder-title">{k}</h3>
                      <button
                        type="button"
                        className="insp-folder-x"
                        title="移除"
                        aria-label={`移除 ${k}`}
                        onClick={() => commitKeywords(keywords.filter((x) => x !== k))}
                      >
                        <X className="ic ic-sm" />
                      </button>
                    </div>
                    <div className="insp-folder-body">
                      <div className={`insp-stack${stack.length ? '' : ' empty'}`}>
                        {stack.length ? (
                          stack.map((ins, i) => (
                            <article
                              className="insp-stack-card"
                              key={ins.id}
                              role="button"
                              tabIndex={0}
                              style={{
                                /* i=0 插进兜里最前；越大越往上抬 */
                                zIndex: stack.length - i,
                                ['--i' as string]: i,
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => setPreview({ ins, keyword: k })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setPreview({ ins, keyword: k })
                                }
                              }}
                            >
                              <h4 className="insp-stack-title">{ins.title}</h4>
                              <div className="insp-stack-perf" aria-hidden="true" />
                              <p className="insp-stack-text">{ins.text}</p>
                            </article>
                          ))
                        ) : (
                          <div className="insp-stack-empty">空文件夹</div>
                        )}
                      </div>
                      <div className="insp-folder-pocket" aria-hidden={!cards.length}>
                        {cards.length > 0 ? (
                          <div className="insp-folder-meta">{cards.length} 张</div>
                        ) : null}
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
        {carousel ? (
          <button
            type="button"
            className="insp-nav next"
            aria-label="下一个关键词"
            onClick={() => step(1)}
          >
            <ChevronRight className="ic" />
          </button>
        ) : null}
      </div>
      {preview ? (
        <InspBadgePreview
          title={preview.ins.title}
          text={preview.ins.text}
          keyword={preview.keyword}
          onClose={() => setPreview(null)}
        />
      ) : null}
      <div className="insp-box">
        <textarea
          rows={2}
          value={draft}
          placeholder="输入关键词，回车添加…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              addDraft()
            }
          }}
        />
      </div>
      </>
      )}
    </div>
  )
}

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

function patchProvider(
  settings: Settings,
  patch: Partial<NonNullable<Settings['sandbox']['provider']>>,
): Settings {
  return {
    ...settings,
    sandbox: {
      ...settings.sandbox,
      env: 'sandbox',
      provider: { ...settings.sandbox.provider, ...patch },
    },
  }
}

/** 纯 chat 的外部沙箱。设置里填了地址和模板才启用；旧的 cube.json 只用来回填一次。 */
function SandboxProviderFields({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const provider = settings.sandbox.provider ?? {}
  const useCube = settings.sandbox.env !== 'local'

  return (
    <>
      <div className="field">
        <div className="field-label">纯 chat 执行环境</div>
        <div className="segmented">
          <button
            className={!useCube ? 'on' : ''}
            onClick={() => onChange({ ...settings, sandbox: { ...settings.sandbox, env: 'local' } })}
          >
            本机
          </button>
          <button
            className={useCube ? 'on' : ''}
            onClick={() =>
              onChange({ ...settings, sandbox: { ...settings.sandbox, env: 'sandbox' } })
            }
          >
            CubeSandbox
          </button>
        </div>
        <div className="field-label" style={{ marginTop: 8 }}>
          <span className="hint">
            {useCube
              ? '只作用于没有绑定工作目录的对话。E2B 兼容的 CubeSandbox，改完下一条消息生效。'
              : '纯 chat 用本机进程目录。绑定了工作目录的会话始终在那个目录里执行。'}
          </span>
        </div>
      </div>
      {useCube ? (
        <>
          <div className="field">
            <div className="field-label">API 地址</div>
            <input
              type="text"
              placeholder="http://主机:3000"
              value={provider.apiUrl ?? ''}
              onChange={(e) => onChange(patchProvider(settings, { apiUrl: e.target.value }))}
            />
          </div>
          <div className="field">
            <div className="field-label">模板 ID</div>
            <input
              type="text"
              placeholder="tpl-…"
              value={provider.templateId ?? ''}
              onChange={(e) => onChange(patchProvider(settings, { templateId: e.target.value }))}
            />
          </div>
          <div className="field">
            <div className="field-label">
              API Key <span className="hint">未开鉴权可留空</span>
            </div>
            <input
              type="password"
              value={provider.apiKey ?? ''}
              onChange={(e) => onChange(patchProvider(settings, { apiKey: e.target.value }))}
            />
          </div>
          <div className="field">
            <div className="field-label">
              节点 IP <span className="hint">数据面，空则用 API 地址里的主机名</span>
            </div>
            <input
              type="text"
              placeholder="可选"
              value={provider.proxyNodeIp ?? ''}
              onChange={(e) => onChange(patchProvider(settings, { proxyNodeIp: e.target.value }))}
            />
          </div>
          <div className="field">
            <div className="field-label">
              顶栏名称 <span className="hint">空则显示主机名</span>
            </div>
            <input
              type="text"
              placeholder="可选"
              value={provider.label ?? ''}
              onChange={(e) => onChange(patchProvider(settings, { label: e.target.value }))}
            />
          </div>
        </>
      ) : null}
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
      <SandboxProviderFields settings={settings} onChange={onChange} />
    </>
  )
}


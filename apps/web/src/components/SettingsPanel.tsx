import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  FolderOpen,
  Globe,
  HardDrive,
  Hash,
  Layers,
  PenTool,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
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
  deleteSkill,
  importDroppedSkillFiles,
  importExternalSkill,
  listSkills,
  pickAndImportSkills,
  readSkill,
  scanExternalSkills,
  skillsAvailable,
  skillsRoot,
  writeSkill,
  type ExternalSkillSource,
  type SkillSummary,
} from '../skills'
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
  skills: ['技能', '管理 SKILL.md；可扫描 Cursor / Claude 等目录并迁移'],
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

/** 平滑折线（Catmull-Rom → 三次贝塞尔） */
function smoothLine(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

function areaPath(points: { x: number; y: number }[], baselineY: number): string {
  if (!points.length) return ''
  const line = smoothLine(points)
  const first = points[0]!
  const last = points[points.length - 1]!
  return `${line} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`
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
  const pad = { t: 16, r: 8, b: 8, l: 8 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const maxY = Math.max(1, ...series.map((d) => Math.max(d.input, d.output)))
  const n = Math.max(1, series.length - 1)
  const ptsIn = series.map((d, i) => ({
    x: pad.l + (i / n) * plotW,
    y: pad.t + plotH - (d.input / maxY) * plotH,
  }))
  const ptsOut = series.map((d, i) => ({
    x: pad.l + (i / n) * plotW,
    y: pad.t + plotH - (d.output / maxY) * plotH,
  }))
  const baseline = pad.t + plotH
  const xLabels = useMemo(() => {
    const want = rangeId === '1h' ? 5 : rangeId === '12h' ? 6 : 7
    const step = Math.max(1, Math.floor((series.length - 1) / Math.max(1, want - 1)))
    const idxs = new Set<number>()
    for (let i = 0; i < series.length; i += step) idxs.add(i)
    idxs.add(series.length - 1)
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
          aria-label={`${range.label}输入与输出 token 面积图`}
        >
          <svg
            className="token-area-svg"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const x = ((e.clientX - rect.left) / rect.width) * W
              const i = Math.round(((x - pad.l) / plotW) * n)
              setHover(Math.max(0, Math.min(series.length - 1, i)))
            }}
          >
            <defs>
              <linearGradient id="tokGradIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="tokGradOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.7" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <path className="token-area-fill is-in" d={areaPath(ptsIn, baseline)} fill="url(#tokGradIn)" />
            <path className="token-area-fill is-out" d={areaPath(ptsOut, baseline)} fill="url(#tokGradOut)" />
            <path className="token-area-line is-in" d={smoothLine(ptsIn)} />
            <path className="token-area-line is-out" d={smoothLine(ptsOut)} />
            {hover != null && ptsIn[hover] && ptsOut[hover] && (
              <g className="token-area-hover">
                <line
                  x1={ptsIn[hover].x}
                  x2={ptsIn[hover].x}
                  y1={pad.t}
                  y2={baseline}
                />
                <circle cx={ptsIn[hover].x} cy={ptsIn[hover].y} r="3.5" className="is-in" />
                <circle cx={ptsOut[hover].x} cy={ptsOut[hover].y} r="3.5" className="is-out" />
              </g>
            )}
          </svg>
          <div className="token-area-xlabels" aria-hidden="true">
            {xLabels.map((i) => {
              const d = series[i]
              if (!d) return null
              const left = ((pad.l + (i / n) * plotW) / W) * 100
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [external, setExternal] = useState<ExternalSkillSource[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [importingKey, setImportingKey] = useState<string | null>(null)
  const [scanHint, setScanHint] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({})
  const available = skillsAvailable()

  const toggleSource = (id: string) => {
    setOpenSources((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))
  }

  const isSourceOpen = (id: string) => openSources[id] ?? true

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

  const onScan = async () => {
    if (!available) return
    setScanning(true)
    setError(null)
    setScanHint(null)
    try {
      const sources = await scanExternalSkills()
      setExternal(sources)
      const found = sources.reduce((n, s) => n + s.skills.length, 0)
      const ready = sources.reduce((n, s) => n + s.skills.filter((x) => !x.installed).length, 0)
      setScanHint(
        found === 0
          ? '未在常见 Agent 目录发现技能'
          : `发现 ${found} 个技能，其中 ${ready} 个可迁移`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const onImportOne = async (sourcePath: string, id: string, overwrite: boolean) => {
    const key = `${sourcePath}::${overwrite ? 'ow' : 'new'}`
    setImportingKey(key)
    setError(null)
    try {
      await importExternalSkill({ sourcePath, id, overwrite })
      await reload()
      const sources = await scanExternalSkills()
      setExternal(sources)
      void syncSkillsIntoHarness()
      setScanHint(overwrite ? `已覆盖更新「${id}」` : `已导入「${id}」`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingKey(null)
    }
  }

  const onImportSource = async (src: ExternalSkillSource) => {
    const pending = src.skills.filter((s) => !s.installed)
    if (pending.length === 0) return
    setImportingKey(`src:${src.id}`)
    setError(null)
    let ok = 0
    let fail = 0
    try {
      for (const s of pending) {
        try {
          await importExternalSkill({ sourcePath: s.path, id: s.id })
          ok++
        } catch {
          fail++
        }
      }
      await reload()
      const sources = await scanExternalSkills()
      setExternal(sources)
      void syncSkillsIntoHarness()
      setScanHint(
        fail === 0
          ? `已从 ${src.label} 导入 ${ok} 个技能`
          : `从 ${src.label} 导入 ${ok} 个，失败 ${fail} 个`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingKey(null)
    }
  }

  const finishUpload = async (imported: SkillSummary[], errors: string[]) => {
    await reload()
    if (imported.length) void syncSkillsIntoHarness()
    if (errors.length) setError(errors.join('\n'))
    if (imported.length) {
      setScanHint(
        imported.length === 1
          ? `已上传「${imported[0]!.name || imported[0]!.id}」`
          : `已上传 ${imported.length} 个技能`,
      )
    } else if (!errors.length) {
      setScanHint('未导入任何技能')
    }
  }

  const onPickUpload = async () => {
    if (uploading) return
    setUploading(true)
    setError(null)
    try {
      const { imported, canceled, errors } = await pickAndImportSkills()
      if (canceled) return
      await finishUpload(imported, errors || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const onDropUpload = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (uploading) return
    const files = Array.from(e.dataTransfer.files || [])
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      const { imported, errors } = await importDroppedSkillFiles(files)
      await finishUpload(imported, errors)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    if (active) void reload()
  }, [active, available])

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

      <div className="skill-scan-block">
        <div className="skill-scan-head">
          <div className="sub-label">扫描与同步</div>
          <button type="button" className="btn btn-sm" disabled={scanning} onClick={() => void onScan()}>
            <RefreshCw className={`ic ic-sm${scanning ? ' spin' : ''}`} />
            {scanning ? '扫描中…' : '扫描其他 Agent'}
          </button>
        </div>
        <p className="user-profile-hint">
          扫描 Cursor / Claude / Codex / Agents 等目录下的技能，迁移到本机 yagent skills。
        </p>
        {scanHint && <div className="skill-scan-hint">{scanHint}</div>}
        {external &&
          external.map((src) => {
            const open = isSourceOpen(src.id)
            return (
              <div className={`skill-source${open ? ' is-open' : ''}`} key={src.id}>
                <div className="skill-source-head">
                  <button
                    type="button"
                    className="skill-source-toggle"
                    aria-expanded={open}
                    onClick={() => toggleSource(src.id)}
                  >
                    <ChevronDown className={`ic ic-sm skill-source-chevron${open ? '' : ' is-collapsed'}`} />
                    <span className="skill-source-title">
                      {src.label}
                      <span className="skill-badge">{src.exists ? `${src.skills.length}` : '未找到'}</span>
                    </span>
                  </button>
                  {src.exists && src.skills.some((s) => !s.installed) ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={importingKey === `src:${src.id}`}
                      onClick={() => void onImportSource(src)}
                    >
                      全部迁移
                    </button>
                  ) : null}
                </div>
                {open && (
                  <>
                    <div className="skill-source-path">{src.root}</div>
                    {!src.exists && <div className="skill-empty">目录不存在</div>}
                    {src.exists && src.skills.length === 0 && (
                      <div className="skill-empty">该目录下没有 SKILL.md</div>
                    )}
                    {src.skills.map((s) => (
                      <div className="skill-card skill-card-ext" key={`${src.id}:${s.id}`}>
                        <div className="skill-card-main">
                          <div className="skill-card-title">
                            {s.name}
                            {s.installed ? (
                              <span className="skill-badge skill-badge-ok">已安装</span>
                            ) : null}
                          </div>
                          <div className="skill-card-desc">{s.description || s.id}</div>
                        </div>
                        <div className="skill-card-actions">
                          {s.installed ? (
                            <button
                              type="button"
                              className="icon-btn"
                              title="覆盖更新"
                              disabled={!!importingKey}
                              onClick={() => {
                                if (!confirm(`用 ${src.label} 的「${s.id}」覆盖本地副本？`)) return
                                void onImportOne(s.path, s.id, true)
                              }}
                            >
                              <RefreshCw className="ic ic-sm" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="icon-btn"
                              title="迁移到 yagent"
                              disabled={!!importingKey}
                              onClick={() => void onImportOne(s.path, s.id, false)}
                            >
                              <Download className="ic ic-sm" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )
          })}
      </div>

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

      <div className="sub-label">上传技能</div>
      <button
        type="button"
        className={`skill-upload-zone${dragOver ? ' is-dragover' : ''}${uploading ? ' is-busy' : ''}`}
        disabled={uploading}
        onClick={() => void onPickUpload()}
        onDragEnter={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragOver(false)
        }}
        onDrop={(e) => void onDropUpload(e)}
      >
        <Upload className={`ic${uploading ? ' spin' : ''}`} />
        <div className="skill-upload-title">
          {uploading ? '正在导入…' : '点击选择，或拖入 .zip / 技能文件夹'}
        </div>
        <div className="skill-upload-hint">需包含 SKILL.md；zip 可含一个或多个技能目录</div>
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

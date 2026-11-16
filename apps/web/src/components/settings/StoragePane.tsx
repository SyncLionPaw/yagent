import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderOpen, RefreshCw } from 'lucide-react'

const STORAGE_LABELS: Record<string, string> = {
  chats: '对话',
  projects: '任务项目',
  insights: '灵感收获',
  skills: '技能',
  'settings.json': '设置',
  'token-usage.json': 'Token 用量',
}

const STORAGE_COLORS = [
  'var(--accent)',
  '#3d8fd1',
  '#1faa6e',
  '#e07a3a',
  '#e08aa4',
  '#d63b3b',
  '#8b7cf6',
  '#94a3b8',
]

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

type StorageEntry = {
  name: string
  rel: string
  bytes: number
  kind: 'dir' | 'file'
  children?: { name: string; rel: string; bytes: number; kind: 'dir' | 'file' }[]
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
}

/** 圆环扇区：angle 从正右逆时针，调用方从 -π/2 起算 */
function donutSlice(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  start: number,
  end: number,
): string {
  const sweep = end - start
  if (sweep <= 0.0001) return ''
  // 满圆用两段弧，避免起终点重合画不出来
  if (sweep >= Math.PI * 2 - 0.0001) {
    const mid = start + Math.PI
    const [ox0, oy0] = polar(cx, cy, rOut, start)
    const [ox1, oy1] = polar(cx, cy, rOut, mid)
    const [ox2, oy2] = polar(cx, cy, rOut, start + Math.PI * 2)
    const [ix0, iy0] = polar(cx, cy, rIn, start + Math.PI * 2)
    const [ix1, iy1] = polar(cx, cy, rIn, mid)
    const [ix2, iy2] = polar(cx, cy, rIn, start)
    return [
      `M ${ox0} ${oy0}`,
      `A ${rOut} ${rOut} 0 1 1 ${ox1} ${oy1}`,
      `A ${rOut} ${rOut} 0 1 1 ${ox2} ${oy2}`,
      `L ${ix0} ${iy0}`,
      `A ${rIn} ${rIn} 0 1 0 ${ix1} ${iy1}`,
      `A ${rIn} ${rIn} 0 1 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ')
  }
  const large = sweep > Math.PI ? 1 : 0
  const [x0, y0] = polar(cx, cy, rOut, start)
  const [x1, y1] = polar(cx, cy, rOut, end)
  const [x2, y2] = polar(cx, cy, rIn, end)
  const [x3, y3] = polar(cx, cy, rIn, start)
  return [
    `M ${x0} ${y0}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ')
}

function StoragePie({
  entries,
  totalBytes,
  hoverRel,
  onHover,
}: {
  entries: StorageEntry[]
  totalBytes: number
  hoverRel: string | null
  onHover: (rel: string | null) => void
}) {
  const slices = useMemo(() => {
    const total = Math.max(0, totalBytes)
    if (total <= 0 || !entries.length) return [] as {
      rel: string
      label: string
      bytes: number
      color: string
      start: number
      end: number
      d: string
    }[]
    const CX = 80
    const CY = 80
    const R_OUT = 68
    const R_IN = 42
    let angle = -Math.PI / 2
    return entries
      .filter((e) => e.bytes > 0)
      .map((e, i) => {
        const sweep = (e.bytes / total) * Math.PI * 2
        const start = angle
        const end = angle + sweep
        angle = end
        return {
          rel: e.rel,
          label: STORAGE_LABELS[e.name] || e.name,
          bytes: e.bytes,
          color: STORAGE_COLORS[i % STORAGE_COLORS.length]!,
          start,
          end,
          d: donutSlice(CX, CY, R_OUT, R_IN, start, end),
        }
      })
  }, [entries, totalBytes])

  const hover = hoverRel ? slices.find((s) => s.rel === hoverRel) : null
  const centerLabel = hover ? hover.label : '合计'
  const centerValue = hover ? formatBytes(hover.bytes) : formatBytes(totalBytes)
  const centerPct =
    hover && totalBytes > 0 ? `${Math.round((hover.bytes / totalBytes) * 100)}%` : null

  return (
    <div className="storage-pie-wrap" role="img" aria-label="各分类磁盘占用占比">
      <svg className="storage-pie" viewBox="0 0 160 160" aria-hidden="true">
        <circle className="storage-pie-track" cx="80" cy="80" r="68" />
        {slices.map((s) => (
          <path
            key={s.rel}
            className={`storage-pie-slice${hoverRel === s.rel ? ' is-hot' : ''}${hoverRel && hoverRel !== s.rel ? ' is-dim' : ''}`}
            d={s.d}
            fill={s.color}
            onMouseEnter={() => onHover(s.rel)}
            onMouseLeave={() => onHover(null)}
          />
        ))}
        <text className="storage-pie-value" x="80" y={centerPct ? 74 : 78} textAnchor="middle">
          {centerValue}
        </text>
        <text className="storage-pie-sub" x="80" y={centerPct ? 92 : 96} textAnchor="middle">
          {centerLabel}
        </text>
        {centerPct ? (
          <text className="storage-pie-pct" x="80" y="108" textAnchor="middle">
            {centerPct}
          </text>
        ) : null}
      </svg>
      <div className="storage-pie-legend">
        {slices.map((s) => {
          const pct = totalBytes > 0 ? Math.round((s.bytes / totalBytes) * 100) : 0
          return (
            <button
              type="button"
              key={s.rel}
              className={`storage-legend-item${hoverRel === s.rel ? ' is-hot' : ''}`}
              onMouseEnter={() => onHover(s.rel)}
              onMouseLeave={() => onHover(null)}
            >
              <i className="storage-swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              <strong>{formatBytes(s.bytes)}</strong>
              <em>{pct}%</em>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function StoragePane({ active }: { active: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [root, setRoot] = useState('')
  const [totalBytes, setTotalBytes] = useState(0)
  const [entries, setEntries] = useState<StorageEntry[]>([])
  const [openRels, setOpenRels] = useState<Set<string>>(() => new Set())
  const [hoverRel, setHoverRel] = useState<string | null>(null)

  const colorByRel = useMemo(() => {
    const map = new Map<string, string>()
    entries.forEach((e, i) => {
      map.set(e.rel, STORAGE_COLORS[i % STORAGE_COLORS.length]!)
    })
    return map
  }, [entries])

  const reload = async () => {
    const api = window.yagentDesktop?.storage?.usage
    if (!api) {
      setError('当前环境无法读取本地存储（需桌面端）')
      setEntries([])
      setTotalBytes(0)
      setRoot('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await api()
      if (!res.ok) {
        setError(res.error || '统计失败')
        setEntries([])
        setTotalBytes(0)
        setRoot(res.root || '')
        return
      }
      setRoot(res.root)
      setTotalBytes(res.totalBytes)
      setEntries(res.entries || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!active) return
    void reload()
  }, [active])

  const maxBytes = Math.max(1, ...entries.map((e) => e.bytes), totalBytes)

  return (
    <>
      <div className="storage-summary">
        <div className="storage-summary-main">
          <div className="storage-summary-label">应用数据合计</div>
          <div className="storage-summary-size">{formatBytes(totalBytes)}</div>
          {root ? (
            <div className="storage-summary-path" title={root}>
              {root}
            </div>
          ) : null}
        </div>
        <div className="storage-summary-actions">
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => void reload()}
            title="重新统计"
          >
            <RefreshCw className={`ic ic-sm${loading ? ' spin' : ''}`} />
            刷新
          </button>
          <button
            type="button"
            className="btn"
            disabled={!window.yagentDesktop?.storage?.reveal}
            onClick={() => void window.yagentDesktop?.storage?.reveal()}
            title="在访达中打开数据目录"
          >
            <FolderOpen className="ic ic-sm" />
            打开目录
          </button>
        </div>
      </div>

      {entries.some((e) => e.bytes > 0) ? (
        <>
          <div className="sub-label">占用构成</div>
          <div className="storage-pie-card">
            <StoragePie
              entries={entries}
              totalBytes={totalBytes}
              hoverRel={hoverRel}
              onHover={setHoverRel}
            />
          </div>
        </>
      ) : null}

      <div className="sub-label">分类占用</div>
      {error ? <div className="files-note">{error}</div> : null}
      {loading && !entries.length ? <div className="files-note">正在统计…</div> : null}
      {!loading && !error && !entries.length ? (
        <div className="files-note">数据目录为空</div>
      ) : null}

      <div className="storage-list">
        {entries.map((e) => {
          const label = STORAGE_LABELS[e.name] || e.name
          const open = openRels.has(e.rel)
          const kids = e.children || []
          const pct = Math.max(2, Math.round((e.bytes / maxBytes) * 100))
          const color = colorByRel.get(e.rel) || STORAGE_COLORS[0]!
          return (
            <div
              className={`storage-row${hoverRel === e.rel ? ' is-hot' : ''}`}
              key={e.rel}
              onMouseEnter={() => setHoverRel(e.rel)}
              onMouseLeave={() => setHoverRel(null)}
            >
              <button
                type="button"
                className={`storage-item${kids.length ? '' : ' is-leaf'}`}
                onClick={() => {
                  if (!kids.length) return
                  setOpenRels((prev) => {
                    const next = new Set(prev)
                    if (next.has(e.rel)) next.delete(e.rel)
                    else next.add(e.rel)
                    return next
                  })
                }}
              >
                {kids.length ? (
                  <ChevronDown className={`ic ic-sm storage-caret${open ? '' : ' is-collapsed'}`} />
                ) : (
                  <span className="storage-caret-gap" />
                )}
                <span className="storage-name">
                  <i className="storage-swatch" style={{ background: color }} />
                  {label}
                  {label !== e.name ? <span className="storage-name-raw">{e.name}</span> : null}
                </span>
                <span className="storage-bytes">{formatBytes(e.bytes)}</span>
                <span className="storage-bar" aria-hidden>
                  <span
                    className="storage-bar-fill"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </span>
              </button>
              {open && kids.length ? (
                <div className="storage-children">
                  {kids.map((c) => {
                    const childPct = Math.max(
                      2,
                      Math.round((c.bytes / Math.max(1, e.bytes)) * 100),
                    )
                    return (
                      <div className="storage-item storage-child" key={c.rel}>
                        <span className="storage-caret-gap" />
                        <span className="storage-name">{c.name}</span>
                        <span className="storage-bytes">{formatBytes(c.bytes)}</span>
                        <span className="storage-bar" aria-hidden>
                          <span
                            className="storage-bar-fill is-child"
                            style={{ width: `${childPct}%`, background: color }}
                          />
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="files-note" style={{ marginTop: 8 }}>
        统计范围为应用数据目录（对话、项目附件、技能等），不含应用本体安装体积。
      </div>
    </>
  )
}

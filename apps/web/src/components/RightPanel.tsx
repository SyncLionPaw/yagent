import { useEffect, useMemo, useState } from 'react'
import { Bookmark, EyeOff, Files, Globe, Lightbulb, PanelRight, Search, Trash2, X } from 'lucide-react'
import type { Conversation, Insight, InsightMark, Ref } from '@yagent/core'
import { formatSize } from '../lib/utils'
import { FileIcon } from './FileIcon'
import { PanelBrowser, type BrowserPage } from './PanelBrowser'
import { ProjectFiles } from './ProjectFiles'
import { SearchSources } from './SearchSources'

export type PanelTab = 'insights' | 'files' | 'search' | 'browser'

type InsightFilter = 'inbox' | 'keep' | 'pass'

interface RightPanelProps {
  conversation: Conversation
  tab: PanelTab
  activeSrcId: number | null
  insights: Insight[]
  /** 收藏库（insights/sight/），可跨会话 */
  sightInsights: Insight[]
  onTabChange: (tab: PanelTab) => void
  onSelectSrc: (id: number | null) => void
  onMarkInsight: (id: string, mark: InsightMark | null) => void
  onDeleteInsight: (id: string) => void
  /** 与主区顶栏「任务面板」相同：收起/展开右栏 */
  onTogglePanel: () => void
}

const BASE_TABS: {
  id: Exclude<PanelTab, 'browser'>
  label: string
  Icon: typeof Files
}[] = [
  { id: 'insights', label: '收获', Icon: Lightbulb },
  { id: 'files', label: '文件', Icon: Files },
  { id: 'search', label: '搜索', Icon: Search },
]

function formatInsightTime(ts: number): string {
  const d = new Date(ts)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}

function InsightsPane({
  insights,
  sightInsights,
  onMark,
  onDelete,
}: {
  insights: Insight[]
  sightInsights: Insight[]
  onMark: (id: string, mark: InsightMark | null) => void
  onDelete: (id: string) => void
}) {
  const [filter, setFilter] = useState<InsightFilter>('inbox')

  const inbox = useMemo(() => insights.filter((i) => !i.mark), [insights])
  const passed = useMemo(() => insights.filter((i) => i.mark === 'pass'), [insights])
  const list = filter === 'inbox' ? inbox : filter === 'pass' ? passed : sightInsights

  const emptyTitle =
    filter === 'inbox'
      ? insights.length
        ? '没有待筛选的收获'
        : '本会话还没有收获'
      : filter === 'keep'
        ? '还没有收藏'
        : '没有略过的收获'

  const emptyDesc =
    filter === 'inbox'
      ? '新收获会出现在这里。'
      : filter === 'keep'
        ? '收藏后会出现在这里。'
        : '点略过的条目会留在这里。'

  const markAndFollow = (id: string, next: InsightMark | null) => {
    onMark(id, next)
    // 打标后跟着切到对应列表，避免「从待看消失」像被删了
    if (next === 'pass') setFilter('pass')
    else if (next === 'keep') setFilter('keep')
    else setFilter('inbox')
  }

  return (
    <div className="insights-pane">
      <div className="insights-hint">可略过或收藏。</div>
      <div className="insights-filters" role="tablist" aria-label="收获筛选">
        {(
          [
            ['inbox', `待看${inbox.length ? ` ${inbox.length}` : ''}`],
            ['keep', `收藏${sightInsights.length ? ` ${sightInsights.length}` : ''}`],
            ['pass', `略过${passed.length ? ` ${passed.length}` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={`insights-filter${filter === id ? ' on' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {!list.length ? (
        <div className="insights-empty">
          <Lightbulb className="ic insights-empty-ic" />
          <div className="insights-empty-title">{emptyTitle}</div>
          <div className="insights-empty-desc">{emptyDesc}</div>
        </div>
      ) : (
        list.map((ins) => (
          <article
            className={`insight-card${ins.mark ? ` mark-${ins.mark}` : ''}`}
            key={ins.id}
          >
            <div className="insight-card-head">
              <div className="insight-title-row">
                <h3 className="insight-title">{ins.title}</h3>
                <span className="insight-tag">{ins.category}</span>
              </div>
              <div className="insight-actions">
                <button
                  type="button"
                  className={`icon-btn${ins.mark === 'pass' ? ' on' : ''}`}
                  title={ins.mark === 'pass' ? '取消略过' : '略过'}
                  aria-label={ins.mark === 'pass' ? '取消略过' : '略过'}
                  onClick={() => markAndFollow(ins.id, ins.mark === 'pass' ? null : 'pass')}
                >
                  <EyeOff className="ic ic-sm" />
                </button>
                <button
                  type="button"
                  className={`icon-btn${ins.mark === 'keep' ? ' on' : ''}`}
                  title={ins.mark === 'keep' ? '取消收藏' : '收藏'}
                  aria-label={ins.mark === 'keep' ? '取消收藏' : '收藏'}
                  onClick={() => markAndFollow(ins.id, ins.mark === 'keep' ? null : 'keep')}
                >
                  <Bookmark className="ic ic-sm" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="删除"
                  aria-label="删除这条收获"
                  onClick={() => onDelete(ins.id)}
                >
                  <Trash2 className="ic ic-sm" />
                </button>
              </div>
            </div>
            <p className="insight-text">{ins.text}</p>
            {ins.why ? <p className="insight-why">{ins.why}</p> : null}
            <div className="insight-meta">
              <span>{formatInsightTime(ins.createdAt)}</span>
            </div>
          </article>
        ))
      )}
    </div>
  )
}

export function RightPanel({
  conversation,
  tab,
  activeSrcId,
  insights,
  sightInsights,
  onTabChange,
  onSelectSrc,
  onMarkInsight,
  onDeleteInsight,
  onTogglePanel,
}: RightPanelProps) {
  const [browserPage, setBrowserPage] = useState<BrowserPage | null>(null)
  const browserOpen = !!browserPage

  // 切换主区会话时清空浏览器页，避免仍显示上一会话
  useEffect(() => {
    setBrowserPage(null)
  }, [conversation.id])

  // 正文角标 / 外部设 activeSrcId：打开浏览器页
  useEffect(() => {
    if (activeSrcId == null) return
    const hit = conversation.refs.find((r) => r.id === activeSrcId)
    if (hit) setBrowserPage({ url: hit.url, title: hit.title })
    else setBrowserPage(null)
  }, [activeSrcId, conversation.refs, conversation.id])

  // 关掉浏览器后若还停在该 tab，退回搜索
  useEffect(() => {
    if (!browserOpen && tab === 'browser') onTabChange('search')
  }, [browserOpen, tab, onTabChange])

  const openInBrowser = (ref: Ref) => {
    setBrowserPage({ url: ref.url, title: ref.title })
    onTabChange('browser')
  }

  const closeBrowser = () => {
    setBrowserPage(null)
    onSelectSrc(null)
    if (tab === 'browser') onTabChange('search')
  }

  return (
    <aside className="panel">
      <div className="panel-tabs">
        {BASE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ptab${tab === t.id ? ' active' : ''}`}
            title={t.label}
            aria-label={t.label}
            onClick={() => onTabChange(t.id)}
          >
            <t.Icon className="ic ic-sm" />
            {t.id === 'insights' && insights.some((i) => !i.mark) ? (
              <span className="ptab-badge">
                {(() => {
                  const n = insights.filter((i) => !i.mark).length
                  return n > 99 ? '99+' : n
                })()}
              </span>
            ) : null}
          </button>
        ))}
        {browserOpen && (
          <span className={`ptab ptab-browser${tab === 'browser' ? ' active' : ''}`}>
            <button
              type="button"
              className="ptab-label"
              title="浏览器"
              aria-label="浏览器"
              onClick={() => onTabChange('browser')}
            >
              <Globe className="ic ic-sm" />
            </button>
            <button
              type="button"
              className="ptab-close"
              title="关闭浏览器"
              aria-label="关闭浏览器"
              onClick={(e) => {
                e.stopPropagation()
                closeBrowser()
              }}
            >
              <X className="ic ic-sm" />
            </button>
          </span>
        )}
        <button
          type="button"
          className="icon-btn panel-collapse"
          title="任务面板"
          aria-label="收起任务面板"
          onClick={onTogglePanel}
        >
          <PanelRight className="ic" />
        </button>
      </div>

      <div className={`p-pane pane-insights${tab === 'insights' ? ' active' : ''}`}>
        <InsightsPane
          insights={insights}
          sightInsights={sightInsights}
          onMark={onMarkInsight}
          onDelete={onDeleteInsight}
        />
      </div>

      <div className={`p-pane pane-files${tab === 'files' ? ' active' : ''}`}>
        {conversation.workdir && window.yagentDesktop?.fs ? (
          <ProjectFiles workdir={conversation.workdir} />
        ) : (
          <>
            <div className="files-half">
              <div className="sub-label">
                用户附件 <span style={{ fontWeight: 400 }}>· 你上传的</span>
              </div>
              {conversation.attachments.map((f) => (
                <div className="sfile" key={f.name}>
                  <FileIcon name={f.name} />
                  <span className="sf-name">{f.name}</span>
                  <span className="sf-meta">{formatSize(f.size)}</span>
                </div>
              ))}
            </div>

            <div className="files-divider"></div>

            <div className="files-half">
              <div className="sub-label">
                Agent 产物 <span style={{ fontWeight: 400 }}>· 本次任务生成</span>
              </div>
              {conversation.outputs.map((f) => (
                <div className="sfile" key={f.name}>
                  <FileIcon name={f.name} />
                  <span className="sf-name">{f.name}</span>
                  <span className="sf-meta">{formatSize(f.size)}</span>
                </div>
              ))}
            </div>

            <div className="files-note">
              仅展示你上传的附件和 Agent 产出的文件，不是完整的沙箱文件系统。
            </div>
          </>
        )}
      </div>

      <div className={`p-pane pane-search${tab === 'search' ? ' active' : ''}`}>
        <SearchSources
          refs={conversation.refs}
          activeSrcId={activeSrcId}
          onSelectSrc={onSelectSrc}
          onOpenInBrowser={openInBrowser}
        />
      </div>

      {browserOpen && (
        <div className={`p-pane pane-browser${tab === 'browser' ? ' active' : ''}`}>
          <PanelBrowser
            page={browserPage}
            onBackToSearch={() => onTabChange('search')}
            onClose={closeBrowser}
            onNavigate={setBrowserPage}
          />
        </div>
      )}
    </aside>
  )
}

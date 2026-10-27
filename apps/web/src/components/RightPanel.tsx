import { useEffect, useState } from 'react'
import { Files, Globe, Lightbulb, Search, Trash2, X } from 'lucide-react'
import type { Conversation, Insight, Ref } from '@yagent/core'
import { formatSize } from '../lib/utils'
import { FileIcon } from './FileIcon'
import { PanelBrowser, type BrowserPage } from './PanelBrowser'
import { ProjectFiles } from './ProjectFiles'
import { SearchSources } from './SearchSources'

export type PanelTab = 'insights' | 'files' | 'search' | 'browser'

interface RightPanelProps {
  conversation: Conversation
  tab: PanelTab
  activeSrcId: number | null
  insights: Insight[]
  onTabChange: (tab: PanelTab) => void
  onSelectSrc: (id: number | null) => void
  onDeleteInsight: (id: string) => void
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
  onDelete,
}: {
  insights: Insight[]
  onDelete: (id: string) => void
}) {
  if (!insights.length) {
    return (
      <div className="insights-empty">
        <Lightbulb className="ic insights-empty-ic" />
        <div className="insights-empty-title">本会话还没有收获</div>
        <div className="insights-empty-desc">
          Agent 发现对你有用、你可能还不知道的东西时，会记在这里。可看可不看。
        </div>
      </div>
    )
  }

  return (
    <div className="insights-pane">
      <div className="insights-hint">仅本会话；可有可无，尽量拆成小点。不强制阅读。</div>
      {insights.map((ins) => (
        <article className="insight-card" key={ins.id}>
          <div className="insight-card-head">
            <h3 className="insight-title">{ins.title}</h3>
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
          <p className="insight-text">{ins.text}</p>
          {ins.why ? <p className="insight-why">{ins.why}</p> : null}
          <div className="insight-meta">{formatInsightTime(ins.createdAt)}</div>
        </article>
      ))}
    </div>
  )
}

export function RightPanel({
  conversation,
  tab,
  activeSrcId,
  insights,
  onTabChange,
  onSelectSrc,
  onDeleteInsight,
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
            {t.id === 'insights' && insights.length > 0 ? (
              <span className="ptab-badge">
                {insights.length > 99 ? '99+' : insights.length}
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
      </div>

      <div className={`p-pane pane-insights${tab === 'insights' ? ' active' : ''}`}>
        <InsightsPane insights={insights} onDelete={onDeleteInsight} />
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

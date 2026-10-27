import { useEffect, useState } from 'react'
import { Files, Globe, Search, X } from 'lucide-react'
import type { Conversation, Ref } from '@yagent/core'
import { formatSize } from '../lib/utils'
import { FileIcon } from './FileIcon'
import { PanelBrowser, type BrowserPage } from './PanelBrowser'
import { ProjectFiles } from './ProjectFiles'
import { SearchSources } from './SearchSources'

export type PanelTab = 'files' | 'search' | 'browser'

interface RightPanelProps {
  conversation: Conversation
  tab: PanelTab
  activeSrcId: number | null
  onTabChange: (tab: PanelTab) => void
  onSelectSrc: (id: number | null) => void
}

const BASE_TABS: {
  id: Exclude<PanelTab, 'browser'>
  label: string
  Icon: typeof Files
}[] = [
  { id: 'files', label: '文件', Icon: Files },
  { id: 'search', label: '搜索', Icon: Search },
]

export function RightPanel({
  conversation,
  tab,
  activeSrcId,
  onTabChange,
  onSelectSrc,
}: RightPanelProps) {
  const [browserPage, setBrowserPage] = useState<BrowserPage | null>(null)
  const browserOpen = !!browserPage

  // 正文角标 / 外部设 activeSrcId：打开浏览器页
  useEffect(() => {
    if (activeSrcId == null) return
    const hit = conversation.refs.find((r) => r.id === activeSrcId)
    if (hit) setBrowserPage({ url: hit.url, title: hit.title })
  }, [activeSrcId, conversation.refs])

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

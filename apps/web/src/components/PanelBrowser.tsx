import { useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, RotateCw, X } from 'lucide-react'

export interface BrowserPage {
  url: string
  title: string
}

interface PanelBrowserProps {
  page: BrowserPage
  onBackToSearch: () => void
  onClose: () => void
  onNavigate: (page: BrowserPage) => void
}

/**
 * 右栏「浏览器」页：地址栏 + iframe。
 * tab 可关；从搜索 / 角标打开。部分站点禁嵌时可外链。
 */
export function PanelBrowser({ page, onBackToSearch, onClose, onNavigate }: PanelBrowserProps) {
  const [draftUrl, setDraftUrl] = useState(page.url)
  const [frameKey, setFrameKey] = useState(0)

  useEffect(() => {
    setDraftUrl(page.url)
  }, [page.url])

  const go = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    let url = t
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    try {
      const u = new URL(url)
      onNavigate({ url: u.href, title: page.title || u.hostname })
      setFrameKey((k) => k + 1)
    } catch {
      // 非法 URL 忽略
    }
  }

  return (
    <div className="panel-browser">
      <div className="crumbs">
        <button type="button" className="crumb-back" title="返回搜索" onClick={onBackToSearch}>
          <ArrowLeft className="ic ic-sm" />
        </button>
        <span className="crumb" onClick={onBackToSearch} role="button">
          搜索
        </span>
        <span className="crumb-sep">/</span>
        <span className="crumb crumb-tab current" title={page.title}>
          {page.title || '页面'}
        </span>
        <button
          type="button"
          className="search-open-ext"
          title="刷新"
          onClick={() => setFrameKey((k) => k + 1)}
        >
          <RotateCw className="ic ic-sm" />
        </button>
        <a
          className="search-open-ext"
          href={page.url}
          target="_blank"
          rel="noreferrer"
          title="在系统浏览器打开"
        >
          <ExternalLink className="ic ic-sm" />
        </a>
        <button type="button" className="search-open-ext" title="关闭浏览器" onClick={onClose}>
          <X className="ic ic-sm" />
        </button>
      </div>

      <form
        className="browser-addr"
        onSubmit={(e) => {
          e.preventDefault()
          go(draftUrl)
        }}
      >
        <input
          type="text"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          spellCheck={false}
          aria-label="地址栏"
        />
      </form>

      <iframe key={frameKey} className="search-frame" title={page.title} src={page.url} />
      <div className="search-frame-hint">
        若页面空白，站点可能禁止内嵌——点右上角图标用系统浏览器打开
      </div>
    </div>
  )
}

import type { Ref } from '@yagent/core'

interface SearchSourcesProps {
  refs: Ref[]
  activeSrcId: number | null
  onSelectSrc: (id: number) => void
  /** 在右侧「浏览器」tab 打开 */
  onOpenInBrowser: (ref: Ref) => void
}

/** 右栏「搜索」：来源卡片列表；点击后在旁边的浏览器 tab 打开 */
export function SearchSources({
  refs,
  activeSrcId,
  onSelectSrc,
  onOpenInBrowser,
}: SearchSourcesProps) {
  if (refs.length === 0) {
    return (
      <div className="files-note">
        尚无来源。Agent 在回答里用{' '}
        <code style={{ fontSize: 11 }}>{'<ref url="…">…</ref>'}</code> 引用网页后，会汇总到这里。
      </div>
    )
  }

  return (
    <div className="search-list">
      {refs.map((r) => (
        <button
          type="button"
          key={r.id}
          className={`src${activeSrcId === r.id ? ' active' : ''}`}
          title={`在浏览器中打开 ${r.url}`}
          onClick={() => {
            onSelectSrc(r.id)
            onOpenInBrowser(r)
          }}
        >
          <div className="src-title">
            <span className="src-num">{r.id}</span>
            {r.title}
          </div>
          <div className="src-url">{r.url}</div>
          {r.snippet ? <div className="src-snippet">{r.snippet}</div> : null}
        </button>
      ))}
    </div>
  )
}

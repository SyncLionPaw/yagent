import { useEffect, useState } from 'react'
import { Check, Copy, Link } from 'lucide-react'

interface ShareButtonProps {
  link: string
  open: boolean
  onToggle: () => void
}

/** 分享：只读快照链接 + 复制反馈（绿勾 1.6s） */
export function ShareButton({ link, open, onToggle }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // 剪贴板不可用时仍给出视觉反馈
    }
    setCopied(true)
  }

  return (
    <div className="model-wrap">
      <button
        className="theme-toggle"
        title="分享对话"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        <Link className="ic" />
      </button>
      <div
        className={`model-pop share-pop${open ? ' open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pop-label">分享此对话</div>
        <div className="share-desc">
          任何获得链接的人都可以<b>只读</b>查看当前分支的对话内容，不能继续操作。
        </div>
        <div className="share-row">
          <input className="share-link" readOnly value={link} />
          <button
            className={`icon-btn share-copy${copied ? ' copied' : ''}`}
            title="复制链接"
            onClick={copy}
          >
            {copied ? <Check className="ic ic-sm" /> : <Copy className="ic ic-sm" />}
          </button>
        </div>
      </div>
    </div>
  )
}

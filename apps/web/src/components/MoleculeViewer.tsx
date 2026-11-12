import { useEffect, useRef, useState } from 'react'

/** 3Dmol 球棍预览；动态 import，避免非浏览器环境顶层读 window */
export function MoleculeViewer({ content, format }: { content: string; format: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null
    let ro: ResizeObserver | null = null

    void import('3dmol').then(($3Dmol) => {
      if (cancelled || !hostRef.current) return
      el.replaceChildren()
      const fmt = normalizeFormat(format)
      try {
        viewer = $3Dmol.createViewer(el, {
          backgroundColor: readCssColor('--bg-code', '#2a2b36'),
          antialias: true,
        })
        const frameHeaders = content.match(/^\s*\d+\s*$/gm)
        const multi = (frameHeaders?.length ?? 0) > 1 && fmt === 'xyz'
        if (multi) {
          viewer.addModelsAsFrames(content, fmt)
          viewer.animate({ loop: 'forward', interval: 80 })
        } else {
          viewer.addModel(content, fmt)
        }
        const style =
          fmt === 'pdb' || fmt === 'cif' || fmt === 'gro'
            ? { cartoon: { color: 'spectrum' }, stick: { radius: 0.12 } }
            : { stick: { radius: 0.15 }, sphere: { scale: 0.25 } }
        viewer.setStyle({}, style)
        viewer.zoomTo()
        viewer.render()
        ro = new ResizeObserver(() => {
          viewer?.resize()
          viewer?.render()
        })
        ro.observe(el)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
      ro?.disconnect()
      try {
        viewer?.clear()
      } catch {
        /* ignore */
      }
      el.replaceChildren()
    }
  }, [content, format])

  if (error) {
    return (
      <div className="file-view file-view-meta">
        <p>结构预览失败：{error}</p>
      </div>
    )
  }

  return <div className="file-view file-view-mol" ref={hostRef} />
}

function normalizeFormat(format: string): string {
  const f = format.toLowerCase().replace(/^\./, '')
  if (f === 'mol') return 'sdf'
  return f
}

function readCssColor(varName: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return v || fallback
}

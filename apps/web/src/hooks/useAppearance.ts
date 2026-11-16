import { useEffect, useState } from 'react'
import type { Settings } from '@yagent/core'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'yagent-theme'

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 主题状态 + 把 theme/accent/skin/contentWidth 同步到 html dataset */
export function useAppearance(settings: Settings) {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.accent = settings.appearance?.accent ?? 'violet'
    root.dataset.skin = settings.appearance?.skin ?? 'default'
    root.dataset.contentWidth = settings.appearance?.contentWidth ?? 'standard'
    localStorage.setItem(THEME_KEY, theme)
  }, [
    theme,
    settings.appearance?.accent,
    settings.appearance?.skin,
    settings.appearance?.contentWidth,
  ])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return { theme, setTheme, toggleTheme }
}

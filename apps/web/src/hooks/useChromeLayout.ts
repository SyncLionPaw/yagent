import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { Settings } from '@yagent/core'
import {
  PANEL_W_DEFAULT,
  PANEL_W_MAX,
  PANEL_W_MIN,
  SIDEBAR_W_DEFAULT,
  SIDEBAR_W_MAX,
  SIDEBAR_W_MIN,
} from '../components/Splitter'
import type { PanelTab } from '../components/RightPanel'
import type { PopoverId } from '../components/Topbar'
import type { SettingsPaneId } from '../settingsMeta'
import { clampPanelW } from '../lib/contextMeter'

/** 侧栏 / 右栏 / 设置翻页 / 弹层 / 快捷键等壳层 UI */
export function useChromeLayout(opts: {
  settings: Settings
  setSettings: Dispatch<SetStateAction<Settings>>
  inspirationOn: boolean
  /** 切会话时收起收藏墙并清空右栏来源角标 */
  activeConvId: string
}) {
  const { settings, setSettings, inspirationOn, activeConvId } = opts

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('files')
  const [sightOpen, setSightOpen] = useState(false)
  const [activeSrcId, setActiveSrcId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 首次打开后保持挂载（关闭后仍保留，翻面回来不闪） */
  const [settingsMounted, setSettingsMounted] = useState(false)
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>('models')
  const [popover, setPopover] = useState<PopoverId>(null)

  useEffect(() => {
    if (settingsOpen) setSettingsMounted(true)
  }, [settingsOpen])
  const [sidebarWidthLive, setSidebarWidthLive] = useState<number | null>(null)
  const [panelWidthLive, setPanelWidthLive] = useState<number | null>(null)

  const sidebarWidth =
    sidebarWidthLive ??
    clampPanelW(settings.appearance?.sidebarWidth, SIDEBAR_W_DEFAULT, SIDEBAR_W_MIN, SIDEBAR_W_MAX)
  const panelWidth =
    panelWidthLive ??
    clampPanelW(settings.appearance?.panelWidth, PANEL_W_DEFAULT, PANEL_W_MIN, PANEL_W_MAX)

  const commitSidebarWidth = useCallback(
    (w: number) => {
      setSidebarWidthLive(null)
      setSettings((s) => ({
        ...s,
        appearance: { ...s.appearance, sidebarWidth: w },
      }))
    },
    [setSettings],
  )
  const commitPanelWidth = useCallback(
    (w: number) => {
      setPanelWidthLive(null)
      setSettings((s) => ({
        ...s,
        appearance: { ...s.appearance, panelWidth: w },
      }))
    },
    [setSettings],
  )

  // ⌘B 侧栏；Esc 关设置
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarCollapsed((v) => !v)
      }
      if (e.key === 'Escape' && settingsOpen) setSettingsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  // 弹层互斥
  useEffect(() => {
    const close = () => setPopover(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // 灵感关闭时收起收藏板，并离开「收获」tab
  useEffect(() => {
    if (inspirationOn) return
    setSightOpen(false)
    setPanelTab((t) => (t === 'insights' ? 'files' : t))
  }, [inspirationOn])

  // 切会话：收回收藏墙、清右栏来源角标
  useEffect(() => {
    setSightOpen(false)
    setActiveSrcId(null)
  }, [activeConvId])

  const openInsightsPanel = useCallback(() => {
    setPanelOpen(true)
    setPanelTab('insights')
  }, [])

  const handleRefClick = useCallback((id: number) => {
    setPanelOpen(true)
    setActiveSrcId(id)
    setPanelTab('browser')
  }, [])

  const handleToggleFiles = useCallback(() => {
    if (panelOpen && panelTab === 'files') {
      setPanelOpen(false)
    } else {
      setPanelOpen(true)
      setPanelTab('files')
    }
  }, [panelOpen, panelTab])

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    panelOpen,
    setPanelOpen,
    panelTab,
    setPanelTab,
    sightOpen,
    setSightOpen,
    activeSrcId,
    setActiveSrcId,
    settingsOpen,
    setSettingsOpen,
    settingsMounted,
    settingsPane,
    setSettingsPane,
    popover,
    setPopover,
    sidebarWidth,
    panelWidth,
    setSidebarWidthLive,
    setPanelWidthLive,
    commitSidebarWidth,
    commitPanelWidth,
    openInsightsPanel,
    handleRefClick,
    handleToggleFiles,
  }
}

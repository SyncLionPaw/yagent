import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '@yagent/core'
import { DEFAULT_SETTINGS, settingsStore } from '../settings'
import { pickInitialModel } from '../harness'
import type { ApprovalMode } from '../approval'
import { migrateLoadedSettings } from '../lib/migrateSettings'

/** 设置加载 / 持久化 / 当前模型 / 审批档位 */
export function useAppSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [currentModelId, setCurrentModelId] = useState(() =>
    pickInitialModel(DEFAULT_SETTINGS.models),
  )
  const loadedRef = useRef(false)
  const [loaded, setLoaded] = useState(false)

  const models = settings.models
  const approvalMode: ApprovalMode =
    settings.tools.approvalMode ?? (settings.tools.autoApprove ? 'all' : 'ask')

  useEffect(() => {
    void settingsStore.load().then(async (s) => {
      const next = migrateLoadedSettings(s)
      const provider = next.sandbox.provider
      const read = window.yagentDesktop?.sandbox?.providerFile
      if (read && !provider?.apiUrl && !provider?.templateId && next.sandbox.env !== 'local') {
        const file = await read().catch(() => null)
        if (file?.apiUrl && file.templateId) {
          next.sandbox = {
            ...next.sandbox,
            env: 'sandbox',
            provider: {
              apiUrl: file.apiUrl,
              apiKey: file.apiKey,
              templateId: file.templateId,
              proxyNodeIp: file.proxyNodeIp,
            },
          }
        }
      }
      loadedRef.current = true
      setLoaded(true)
      setSettings(next)
      setCurrentModelId(pickInitialModel(next.models))
    })
  }, [])

  useEffect(() => {
    if (!loadedRef.current) return
    void settingsStore.save(settings).catch(() => undefined)
  }, [settings])

  const handleApprovalModeChange = useCallback((mode: ApprovalMode) => {
    setSettings((s) => ({
      ...s,
      tools: { ...s.tools, approvalMode: mode, autoApprove: mode === 'all' },
    }))
  }, [])

  const handleSettingsChange = useCallback((next: Settings) => {
    setSettings(next)
    if (!next.models.some((m) => m.id === currentModelId)) {
      setCurrentModelId(next.models[0]?.id ?? '')
    }
  }, [currentModelId])

  return {
    settings,
    setSettings,
    loaded,
    models,
    currentModelId,
    setCurrentModelId,
    approvalMode,
    handleApprovalModeChange,
    handleSettingsChange,
  }
}

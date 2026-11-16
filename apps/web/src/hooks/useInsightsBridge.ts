import { useCallback, useEffect, useState } from 'react'
import type { Insight, InsightMark } from '@yagent/core'
import { harness } from '../harness'
import {
  deleteInsight,
  listSightInsights,
  markInsight,
  newInsightId,
  readInsights,
  registerInsightHandler,
  writeInsight,
} from '../insights'
import type { Settings } from '@yagent/core'

/**
 * 会话收获 + 收藏墙；注册 save_insight；迁移旧 settings.insights。
 */
export function useInsightsBridge(opts: {
  conversationId: string | undefined
  insightIds: string[] | undefined
  settingsInsights: Settings['insights']
  settingsLoaded: boolean
  onSettingsChange: (fn: (s: Settings) => Settings) => void
  onOpenInsightsPanel: () => void
}) {
  const {
    conversationId,
    insightIds,
    settingsInsights,
    settingsLoaded,
    onSettingsChange,
    onOpenInsightsPanel,
  } = opts

  const [convInsights, setConvInsights] = useState<Insight[]>([])
  const [sightInsights, setSightInsights] = useState<Insight[]>([])
  const insightIdsKey = (insightIds ?? []).join(',')

  const refreshSight = useCallback(() => {
    void listSightInsights().then(setSightInsights)
  }, [])

  useEffect(() => {
    registerInsightHandler(async (draft) => {
      const insight: Insight = {
        id: newInsightId(),
        title: draft.title,
        text: draft.text,
        category: draft.category,
        ...(draft.why ? { why: draft.why } : {}),
        ...(draft.convId ? { convId: draft.convId } : {}),
        createdAt: Date.now(),
      }
      await writeInsight(insight)
      if (draft.convId) harness.addInsightId(draft.convId, insight.id)
      onOpenInsightsPanel()
      return insight
    })
    return () => registerInsightHandler(null)
  }, [onOpenInsightsPanel])

  // 旧版 settings.insights → 文件 + 会话 id 列表
  useEffect(() => {
    if (!settingsLoaded) return
    const legacy = settingsInsights
    if (!legacy?.length) return
    void (async () => {
      for (const ins of legacy) {
        await writeInsight({ ...ins, category: ins.category?.trim() || '未分类' })
        if (ins.convId && harness.getConversation(ins.convId)) {
          harness.addInsightId(ins.convId, ins.id)
        }
      }
      onSettingsChange((s) => ({ ...s, insights: [] }))
    })()
  }, [settingsInsights, settingsLoaded, onSettingsChange])

  useEffect(() => {
    const ids = insightIds ?? []
    let alive = true
    void readInsights(ids).then((list) => {
      if (!alive) return
      const map = new Map(list.map((i) => [i.id, i]))
      setConvInsights(ids.map((id) => map.get(id)).filter((x): x is Insight => !!x))
    })
    return () => {
      alive = false
    }
  }, [conversationId, insightIdsKey])

  useEffect(() => {
    refreshSight()
  }, [refreshSight, insightIdsKey])

  const handleMarkInsight = useCallback(
    (insightId: string, mark: InsightMark | null) => {
      const hit =
        convInsights.find((x) => x.id === insightId) ??
        sightInsights.find((x) => x.id === insightId)
      if (!hit) return
      void markInsight(hit, mark).then((next) => {
        setConvInsights((list) => {
          const i = list.findIndex((x) => x.id === next.id)
          if (i < 0) return list
          const copy = list.slice()
          copy[i] = next
          return copy
        })
        refreshSight()
      })
    },
    [convInsights, sightInsights, refreshSight],
  )

  const handleDeleteInsight = useCallback(
    (insightId: string) => {
      if (conversationId) harness.removeInsightId(conversationId, insightId)
      void deleteInsight(insightId).then(() => {
        setConvInsights((list) => list.filter((x) => x.id !== insightId))
        refreshSight()
      })
    },
    [conversationId, refreshSight],
  )

  const handleSightMove = useCallback(
    (id: string, x: number, y: number) => {
      const hit =
        sightInsights.find((n) => n.id === id) ?? convInsights.find((n) => n.id === id)
      if (!hit) return
      const next = { ...hit, board: { x, y }, mark: 'keep' as const }
      void writeInsight(next).then(() => {
        setSightInsights((list) => list.map((n) => (n.id === id ? next : n)))
        setConvInsights((list) =>
          list.map((n) => (n.id === id ? { ...n, board: { x, y } } : n)),
        )
      })
    },
    [sightInsights, convInsights],
  )

  return {
    convInsights,
    sightInsights,
    refreshSight,
    handleMarkInsight,
    handleDeleteInsight,
    handleSightMove,
  }
}

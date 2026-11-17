import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContextSnapshot, Conversation, ModelConfig, Settings } from '@yagent/core'
import {
  configureHarness,
  harness,
  setInsightEnabled,
  setInsightKeywords,
  syncChatSandbox,
  syncSkillsIntoHarness,
  updateToolsFor,
} from '../harness'
import { recordTokenUsage } from '../tokenUsage'
import { readContextSnapshot, toContextMeter } from '../lib/contextMeter'
import type { ContextMeter } from '../components/Composer'

type Tools = Settings['tools']
type Inspiration = Settings['inspiration']

/**
 * harness 事件订阅（rAF 合帧）+ 会话列表重读 + 上下文占用 + provider/工具/skills 同步。
 */
export function useHarnessBridge(opts: {
  activeConvId: string
  models: ModelConfig[]
  currentModelId: string
  tools: Tools
  inspiration: Inspiration
  remoteToolsDegraded: boolean
}) {
  const {
    activeConvId,
    models,
    currentModelId,
    tools,
    inspiration,
    remoteToolsDegraded,
  } = opts

  const [harnessTick, setHarnessTick] = useState(0)
  const [contextSnap, setContextSnap] = useState<ContextSnapshot | null>(null)
  const usageTotalsRef = useRef(new Map<string, { input: number; output: number }>())

  // 订阅 harness 事件 → 重渲染；rAF 合帧：token 突发时一帧内多个事件只触发一次渲染
  useEffect(() => {
    let raf = 0
    const unsub = harness.on((e) => {
      if (e.type === 'context_updated') {
        if (e.convId === activeConvId) setContextSnap(e.snapshot)
        const t = e.snapshot.totals
        const prev = usageTotalsRef.current.get(e.convId)
        if (prev && (t.input > prev.input || t.output > prev.output)) {
          void recordTokenUsage({
            input: Math.max(0, t.input - prev.input),
            output: Math.max(0, t.output - prev.output),
          })
        }
        usageTotalsRef.current.set(e.convId, { input: t.input, output: t.output })
      }
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setHarnessTick((n) => n + 1)
      })
    })
    return () => {
      cancelAnimationFrame(raf)
      unsub()
    }
  }, [activeConvId])

  // 切换会话时拉一次估算占用
  useEffect(() => {
    setContextSnap(readContextSnapshot(activeConvId))
  }, [activeConvId])

  // 设置 / 当前模型 → 装配 harness provider（下一条消息生效）
  useEffect(() => {
    configureHarness(models.find((m) => m.id === currentModelId))
    setContextSnap(readContextSnapshot(activeConvId))
  }, [models, currentModelId, activeConvId])

  // Skills L1：启动时扫 skills 目录写入 system
  useEffect(() => {
    void syncSkillsIntoHarness()
  }, [])

  const inspirationOn = inspiration?.enabled === true

  // 会话切换 / 工具或灵感设置变更 → 更新工具与 skills
  useEffect(() => {
    setInsightEnabled(inspirationOn)
    setInsightKeywords(inspiration?.keywords)
    if (harness.getConversation(activeConvId)) {
      void syncChatSandbox(activeConvId).then(() => {
        updateToolsFor(activeConvId, tools, { remoteOffline: remoteToolsDegraded })
      })
    }
    void syncSkillsIntoHarness()
  }, [activeConvId, tools, inspiration, inspirationOn, remoteToolsDegraded])

  const conversations: Conversation[] = useMemo(
    () => harness.listConversations().slice().reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- harness 可变，靠 tick 重读
    [harnessTick],
  )

  const conversation = conversations.find((c) => c.id === activeConvId) ?? conversations[0]
  const harnessConv = conversation ? harness.getConversation(conversation.id) : undefined
  const running = harnessConv?.status === 'running'
  const queuedItems = conversation ? harness.pendingPreview(conversation.id) : []
  const contextMeter: ContextMeter | null = useMemo(
    () => (contextSnap ? toContextMeter(contextSnap) : null),
    [contextSnap],
  )

  return {
    harnessTick,
    conversations,
    conversation,
    running,
    queuedItems,
    contextMeter,
    inspirationOn,
  }
}

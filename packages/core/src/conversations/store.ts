/* ============ 会话 Store：订阅 Harness 事件，JSONL 追加落盘 / 启动恢复 ============
 * 事件只标记脏节点/脏元数据，落盘时只追加变脏的记录；
 * 流式 delta 只标脏不排程（中间版本不落盘），一轮跑完（done/waiting）立即 flush，
 * 其余事件按会话 600ms 防抖。行数超阈值（3×节点数，至少 compactMinLines）时整体重写压缩。
 */

import type { Conversation } from '../model.js'
import type { Harness } from '../harness/harness.js'
import type { HarnessEvent } from '../harness/events.js'
import type { ConversationStorage } from './storage.js'
import { countLines, conversationKey, decodeConversation, encodeConversation, metaLineOf } from './codec.js'

const DEBOUNCE_MS = 600
const DEFAULT_COMPACT_MIN_LINES = 200

export interface ConversationStoreOptions {
  compactMinLines?: number // 压缩阈值下限，默认 200（测试可调小）
}

export class ConversationStore {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly dirtyNodes = new Map<string, Set<string>>()
  private readonly dirtyMeta = new Set<string>()
  private readonly lineCounts = new Map<string, number>()
  private readonly storedKeys = new Map<string, string>() // convId → 上次落盘的 key（检测换目录/迁移）
  private readonly compactMinLines: number
  private importing = false

  constructor(
    private readonly harness: Harness,
    private readonly storage: ConversationStorage,
    opts: ConversationStoreOptions = {},
  ) {
    this.compactMinLines = opts.compactMinLines ?? DEFAULT_COMPACT_MIN_LINES
    harness.on((e) => this.onEvent(e))
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushAll())
    }
  }

  /** 启动恢复：读全部 JSONL → fold 重建 → 注入 harness。返回恢复条数 */
  async loadAll(): Promise<number> {
    const entries = await this.storage.list()
    this.importing = true
    let loaded = 0
    try {
      for (const { key, text } of entries) {
        const conv = decodeConversation(text)
        if (!conv) continue
        this.lineCounts.set(conv.id, countLines(text))
        this.storedKeys.set(conv.id, key)
        this.harness.importConversation(conv)
        loaded++
      }
    } finally {
      this.importing = false
    }
    return loaded
  }

  /** 立即整体写入（播种 / 迁移用），不等防抖 */
  persist(convId: string): void {
    const conv = this.harness.getConversation(convId)
    if (!conv || Object.keys(conv.nodes).length === 0) return
    const key = conversationKey(conv)
    const text = encodeConversation(conv)
    this.lineCounts.set(convId, countLines(text))
    const prevKey = this.storedKeys.get(convId)
    this.storedKeys.set(convId, key)
    void (async () => {
      await this.storage.write(key, text)
      if (prevKey && prevKey !== key) await this.storage.delete(prevKey)
    })().catch(() => undefined)
  }

  /** 删除：先落盘层删，再从 harness 删 */
  async remove(id: string): Promise<void> {
    const t = this.pending.get(id)
    if (t) clearTimeout(t)
    this.pending.delete(id)
    this.dirtyNodes.delete(id)
    this.dirtyMeta.delete(id)
    this.lineCounts.delete(id)
    const key = this.storedKeys.get(id)
    this.storedKeys.delete(id)
    await this.storage.delete(key ?? `${id}.jsonl`).catch(() => undefined)
    this.harness.deleteConversation(id)
  }

  /** 立即保存指定会话（清掉未决防抖） */
  flush(convId: string): void {
    const t = this.pending.get(convId)
    if (t) {
      clearTimeout(t)
      this.pending.delete(convId)
    }
    this.appendDirty(convId)
  }

  /** 退页前尽力 flush 全部未决 */
  flushAll(): void {
    for (const [id, t] of this.pending) clearTimeout(t)
    this.pending.clear()
    for (const id of new Set([...this.dirtyMeta, ...this.dirtyNodes.keys()])) {
      this.appendDirty(id)
    }
  }

  /* ---------- 事件 → 脏标记 ---------- */

  private onEvent(e: HarnessEvent): void {
    if (this.importing) return
    switch (e.type) {
      case 'text_delta':
      case 'thinking_delta':
        // 流式 delta 只标脏不排程：中间版本不落盘，等一轮结束（done/waiting）统一 flush
        this.markNode(e.convId, e.nodeId)
        break
      case 'node_added':
        // activeNodeId 的变化不追加 meta——它随 conv_status_changed 的 flush 一起写
        this.markNode(e.convId, e.node.id)
        this.schedule(e.convId)
        break
      case 'node_updated':
      case 'tool_status':
        this.markNode(e.convId, e.nodeId)
        this.schedule(e.convId)
        break
      case 'conv_updated':
        this.markMeta(e.convId)
        this.schedule(e.convId)
        break
      case 'conv_status_changed':
        this.markMeta(e.convId)
        if (e.status === 'done' || e.status === 'waiting') this.flush(e.convId)
        else this.schedule(e.convId)
        break
      case 'error':
        if (e.nodeId) this.markNode(e.convId, e.nodeId)
        this.schedule(e.convId)
        break
    }
  }

  private markNode(convId: string, nodeId: string): void {
    let set = this.dirtyNodes.get(convId)
    if (!set) {
      set = new Set()
      this.dirtyNodes.set(convId, set)
    }
    set.add(nodeId)
  }

  private markMeta(convId: string): void {
    this.dirtyMeta.add(convId)
  }

  private schedule(convId: string): void {
    const prev = this.pending.get(convId)
    if (prev) clearTimeout(prev)
    this.pending.set(
      convId,
      setTimeout(() => {
        this.pending.delete(convId)
        this.appendDirty(convId)
      }, DEBOUNCE_MS),
    )
  }

  /* ---------- 落盘 ---------- */

  private appendDirty(convId: string): void {
    const conv = this.harness.getConversation(convId)
    if (!conv) {
      this.dirtyNodes.delete(convId)
      this.dirtyMeta.delete(convId)
      return
    }
    if (Object.keys(conv.nodes).length === 0) return // 空会话不落盘

    const lines: string[] = []
    if (this.dirtyMeta.delete(convId)) lines.push(metaLineOf(conv))
    const dirty = this.dirtyNodes.get(convId)
    if (dirty) {
      for (const nid of dirty) {
        const n = conv.nodes[nid]
        if (n) lines.push(JSON.stringify(n))
      }
      this.dirtyNodes.delete(convId)
    }
    if (!lines.length) return

    // key 由当前 workdir 决定；换目录 / 旧格式迁移时，写新 key 后删旧 key
    const key = conversationKey(conv)
    const prevKey = this.storedKeys.get(convId)
    const chunk = lines.join('\n') + '\n'

    // 压缩：历史版本堆积过多时整体重写
    const total = (this.lineCounts.get(convId) ?? 0) + lines.length
    const nodeCount = Object.keys(conv.nodes).length
    const compact = total > Math.max(3 * nodeCount, this.compactMinLines)
    this.lineCounts.set(convId, compact ? countLines(encodeConversation(conv)) : total)
    this.storedKeys.set(convId, key)
    void (async () => {
      if (compact) await this.storage.write(key, encodeConversation(conv))
      else await this.storage.append(key, chunk)
      if (prevKey && prevKey !== key) await this.storage.delete(prevKey)
    })().catch(() => undefined)
  }
}

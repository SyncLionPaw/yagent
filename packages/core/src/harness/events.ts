/* ============ HarnessEvent：Harness 对外的事件类型 ============ */

import type { Conversation, ConversationNode } from '../model.js'
import type { ContextSnapshot } from './context.js'

export type HarnessEvent =
  | { type: 'node_added'; convId: string; node: ConversationNode }
  | { type: 'node_updated'; convId: string; nodeId: string }
  | { type: 'conv_updated'; convId: string } // 创建 / 改名 / activeNode 切换
  | { type: 'conv_status_changed'; convId: string; status: Conversation['status'] }
  | { type: 'text_delta'; convId: string; nodeId: string; delta: string }
  | { type: 'thinking_delta'; convId: string; nodeId: string; delta: string }
  | { type: 'tool_status'; convId: string; nodeId: string; blockIndex: number; status: 'running' | 'done' | 'error' }
  | { type: 'context_updated'; convId: string; snapshot: ContextSnapshot }
  | { type: 'error'; convId: string; nodeId?: string; error: Error }

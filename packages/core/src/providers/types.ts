/* ============ 模型请求层：统一抽象 ============
 * 纯 fetch + ReadableStream 实现，Web / Electron / Node 18+ 通用。
 */

export type ChatRole = 'user' | 'assistant'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface ChatMessage {
  role: ChatRole
  content: string | ContentBlock[]
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; usage?: { input: number; output: number } }
  | { type: 'error'; error: Error }

export interface ChatRequest {
  model: string
  system?: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  signal?: AbortSignal
}

export interface ModelProvider {
  readonly id: string
  streamChat(req: ChatRequest): AsyncIterable<StreamEvent>
}

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

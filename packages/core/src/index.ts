export const APP_NAME = 'yagent'

/* ============ 数据模型（设计稿 SPEC.md §8） ============ */

export type Role = 'user' | 'agent'

// 会话节点：树结构，分叉 = 一个节点多个 children
export interface ConversationNode {
  id: string
  parentId: string | null
  role: Role
  blocks: Block[]
  createdAt: number
  durationMs?: number // agent 节点耗时
}

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; status: 'streaming' | 'done'; durationMs?: number }
  | {
      type: 'tool'
      tool: string
      summary: string
      status: 'running' | 'done' | 'error'
      detail?: string
      stats?: string
      toolUseId?: string // 模型侧工具调用 id（回放 messages 时用）
      input?: Record<string, unknown> // 调用参数
    }
  | { type: 'tool_result'; tool: string; toolUseId?: string; content: string; isError?: boolean }
  | { type: 'artifacts'; items: Artifact[] }

export interface Ref {
  id: number
  title: string
  url: string
  snippet: string
}

export interface Artifact {
  id: string
  name: string
  kind: 'code' | 'doc' | 'html' | 'image'
  size: number
  createdAt: number
}

export interface SandboxFile {
  name: string
  size: number
}

export interface Conversation {
  id: string
  title: string // 顶栏可改名
  workdir: string | null // null = 纯 chat（顶栏显示 "chat"）
  nodes: Record<string, ConversationNode>
  activeNodeId: string
  status: 'running' | 'waiting' | 'done'
  refs: Ref[]
  attachments: SandboxFile[] // 用户附件
  outputs: SandboxFile[] // Agent 产物
}

export type Mode = 'chat' | 'local' | 'cloud'

export interface ModelConfig {
  id: string
  name: string
  provider: string
  modelId: string
  context: number
  isDefault?: boolean
}

export interface Memory {
  id: string
  text: string
  sourceCount: number
  updatedAt: number
}

export interface Settings {
  apiKeys: {
    anthropic?: string
    openai?: string
    deepseek?: string
    customEndpoint?: string
    customKey?: string
  }
  models: ModelConfig[]
  memories: Memory[]
  tools: { terminal: boolean; fileEdit: boolean; webSearch: boolean }
  sandbox: { env: 'local' | 'sandbox'; workdir: string; network: boolean }
}

/* ============ 沙箱（SPEC.md §11）：可插拔 Provider，本期不实现 ============ */

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface SandboxProvider {
  exec(cmd: string, cwd?: string): Promise<ExecResult>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}

export interface AgentConfig {
  id: string
  name: string
  model: string
  createdAt: string
}

export interface ApiClientOptions {
  baseUrl: string
  headers?: Record<string, string>
}

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${options.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...options.headers, ...init?.headers },
    })
    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  }
}

/* ============ 模型请求层 + Harness ============ */

export * from './providers/index.js'
export * from './harness/index.js'

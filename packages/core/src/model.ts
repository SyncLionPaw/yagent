export const APP_NAME = 'yagent'

/* ============ 数据模型（设计稿 SPEC.md §8） ============ */

export type Role = 'user' | 'agent' | 'round'

// 会话节点：树结构，分叉 = 一个节点多个 children。
// round 节点 = 一次完整问答：blocks[0] 是用户输入，其余是该轮的思考/工具/结果/回答。
// user/agent 为旧版粒度（一条消息一个节点），仅用于兼容已持久化的老会话。
export interface ConversationNode {
  id: string
  parentId: string | null
  role: Role
  blocks: Block[]
  createdAt: number
  durationMs?: number // round/agent 节点耗时
}

export type Block =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      mime: string
      name: string
      /** 应用附件目录绝对路径（供工具读）；可缺省 */
      path?: string
      /** raw base64，多模态回放用 */
      data: string
    }
  | {
      type: 'file'
      name: string
      size: number
      path?: string
      mime?: string
      /** 气泡旁缩略预览（与 Composer 对齐）；pdf 过大可不存 */
      preview?:
        | { kind: 'html'; html: string }
        | { kind: 'md'; text: string }
        | { kind: 'pdf'; dataUrl: string }
    }
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

/** 用户消息附带的图片（走厂商 image / image_url） */
export interface UserImageAttach {
  mime: string
  name: string
  path?: string
  data: string // raw base64
}

/** 非图片附件（UI 卡片；内容已在消息附注或由工具按路径读取） */
export interface UserFileAttach {
  name: string
  size: number
  path?: string
  mime?: string
  preview?:
    | { kind: 'html'; html: string }
    | { kind: 'md'; text: string }
    | { kind: 'pdf'; dataUrl: string }
}

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
  archived?: boolean // 归档后从主列表隐藏，可在「已归档」恢复
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
  apiKey?: string // 密钥跟随模型配置（BYOK，仅本地存储）
  baseURL?: string // provider = custom 时的 OpenAI 兼容端点
  isDefault?: boolean
}

export interface Memory {
  id: string
  text: string
  sourceCount: number
  updatedAt: number
}

/** 强调色主题：驱动全局 --accent* */
export type AccentId =
  | 'violet'
  | 'frost-green'
  | 'summer-orange'
  | 'ice-blue'
  | 'sakura-pink'
  | 'maple-red'

/** 对话主区内容宽度 */
export type ContentWidth = 'standard' | 'wide' | 'full'

export interface Settings {
  models: ModelConfig[]
  memories: Memory[]
  tools: {
    terminal: boolean
    fileEdit: boolean
    webSearch: boolean
    /**
     * 工具审批档位（输入框三档开关）：
     * - `ask`：写文件 / 跑命令都要确认
     * - `files`：写文件自动过，跑命令仍要确认
     * - `all`：全部自动执行
     * 旧字段 `autoApprove: true` 等价 `all`。
     */
    approvalMode?: 'ask' | 'files' | 'all'
    /** @deprecated 请用 approvalMode；true → all，false → ask */
    autoApprove?: boolean
    /**
     * search_web / fetch_url 后端：`bing`（默认，抓 HTML）|
     * `deepseek`（官方 Search/Fetch API，复用 DeepSeek 模型条目的 apiKey）
     */
    webProvider?: 'bing' | 'deepseek'
    /**
     * 语音识别（ASR）。DeepSeek 无语音接口。
     * - groq：免费档 Whisper，需 Groq API Key
     * - openai：官方 Whisper
     * - custom：本地 FunASR/SenseVoice 等 OpenAI 兼容 `/v1/audio/transcriptions`
     */
    asr?: {
      provider?: 'groq' | 'openai' | 'custom'
      apiKey?: string
      baseURL?: string
      model?: string
    }
  }
  sandbox: { env: 'local' | 'sandbox'; workdir: string; network: boolean }
  /** 外观：主题强调色等（亮/暗模式仍由客户端本地切换） */
  appearance?: {
    accent?: AccentId
    /** 对话 / 输入框内容列宽；缺省 standard（700px） */
    contentWidth?: ContentWidth
    /** 左侧栏宽度（px）；缺省 236 */
    sidebarWidth?: number
    /** 右侧面板宽度（px）；缺省 288 */
    panelWidth?: number
  }
  /** 本地用户资料（仅本机，无账号体系） */
  user?: {
    nickname?: string
  }
  /**
   * 知识库连接（设置 → 知识库）。
   * 本期先登记来源；检索 / RAG / MCP 拉取尚未接线。
   */
  knowledgeBases?: {
    sources: KnowledgeSource[]
  }
}

export type KnowledgeSourceKind =
  | 'local'
  | 'notion'
  | 'gdrive'
  | 'feishu'
  | 'confluence'
  | 'web'

export interface KnowledgeSource {
  id: string
  kind: KnowledgeSourceKind
  name: string
  /** 本地目录路径，或远程标识 / URL */
  target?: string
  connectedAt: number
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

/* ============ Web 端 Harness 单例 + provider 装配 ============
 * provider 选择：设置里的当前模型 → 按 provider 字段选 Anthropic / OpenAI 兼容端点 + 对应 key。
 * 工具注入：绑定工作目录的会话给文件工具（读/写文件、执行命令）；
 * fetch_url 始终可用，search_web 跟随设置里的「网络搜索」开关；两者都不依赖目录。
 * 工具经 Electron IPC 在主进程执行，浏览器端工具不可用。
 * DeepSeek 直连（其 API 支持浏览器 CORS，已验证 preflight）；dev 下未填 key 时
 * 回退到 vite 注入的 DEV_DEEPSEEK_KEY（见 vite.config.ts，仅 dev server 注入）。
 */

import {
  AnthropicProvider,
  DEFAULT_TOOLS,
  formatSkillsSystemAppendix,
  Harness,
  OpenAIProvider,
  type ToolExecutor,
} from '@yagent/core'
import type { ChatRequest, ModelConfig, ModelProvider, Settings, StreamEvent } from '@yagent/core'
import { requestApproval } from './approval'
import { listSkills, skillsAvailable } from './skills'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/** 缺 key 时的占位 provider：发消息立即给出可读错误，而不是 401 */
class MissingKeyProvider implements ModelProvider {
  readonly id = 'missing-key'
  private readonly hint: string
  constructor(hint: string) {
    this.hint = hint
  }
  async *streamChat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    yield { type: 'error', error: new Error(this.hint) }
  }
}

/* ---------- key 读取与脱敏 ---------- */

/** 清洗 key：去首尾空白、引号和控制字符（粘贴时容易带入换行/全角空格） */
export function cleanKey(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
}

/** key 是否含 Latin-1 之外的字符（全角字符等）——fetch header 不接受，需提示重新粘贴 */
export function keyHasBadChars(raw: string | undefined): boolean {
  return /[^\x20-\x7e]/.test((raw ?? '').trim().replace(/^["']+|["']+$/g, ''))
}

const BAD_KEY_MSG = 'API Key 含非法字符（可能粘贴时带入了空格、换行或全角字符），请在 设置 → 模型配置 中重新粘贴'

/** dev 预填的 DeepSeek key（生产为空串） */
export function devDeepseekKey(): string {
  return cleanKey(import.meta.env.DEV_DEEPSEEK_KEY as string | undefined)
}

/** 模型的有效 key：deepseek 在 dev 下可用 .env 预填兜底，其余只认模型条目里的 apiKey */
export function effectiveKey(model: ModelConfig): string {
  if (model.provider === 'deepseek') return devDeepseekKey() || cleanKey(model.apiKey)
  return cleanKey(model.apiKey)
}

export function hasKeyFor(model: ModelConfig): boolean {
  if (model.provider === 'custom') return !!cleanKey(model.baseURL) && !!effectiveKey(model)
  return !!effectiveKey(model)
}

/** 初始模型：默认模型有 key 用默认；否则选第一个有 key 的（dev 下通常是 DeepSeek） */
export function pickInitialModel(models: ModelConfig[]): string {
  const def = models.find((m) => m.isDefault) ?? models[0]
  if (def && hasKeyFor(def)) return def.id
  const usable = models.find((m) => hasKeyFor(m))
  return (usable ?? def)?.id ?? ''
}

/** 脱敏显示：sk-•••ab12（头 3 + 尾 4） */
export function maskKey(key: string): string {
  const t = key.trim()
  if (t.length <= 7) return '••••'
  return `${t.slice(0, 3)}•••${t.slice(-4)}`
}

/* ---------- provider 装配 ---------- */

export function resolveProvider(model: ModelConfig | undefined): ModelProvider {
  if (!model) return new MissingKeyProvider('尚未选择模型')
  if (keyHasBadChars(model.apiKey) || keyHasBadChars(model.baseURL)) {
    return new MissingKeyProvider(BAD_KEY_MSG)
  }
  const key = effectiveKey(model)
  switch (model.provider) {
    case 'anthropic':
      return key
        ? new AnthropicProvider({ apiKey: key })
        : new MissingKeyProvider('未配置 API Key，请在 设置 → 模型配置 中填写')
    case 'openai':
      return key
        ? new OpenAIProvider({ apiKey: key })
        : new MissingKeyProvider('未配置 API Key，请在 设置 → 模型配置 中填写')
    case 'deepseek':
      return key
        ? new OpenAIProvider({ apiKey: key, baseURL: DEEPSEEK_BASE_URL })
        : new MissingKeyProvider('未配置 API Key，请在 设置 → 模型配置 中填写')
    case 'custom': {
      const baseURL = cleanKey(model.baseURL).replace(/\/+$/, '')
      return baseURL && key
        ? new OpenAIProvider({ apiKey: key, baseURL })
        : new MissingKeyProvider('自定义端点未填完整（端点 + Key），请在 设置 → 模型配置 中填写')
    }
    default:
      return new MissingKeyProvider(`未知 provider：${model.provider}`)
  }
}

/* ---------- 单例 ---------- */

// 需要用户在审批条上确认的危险工具
const APPROVAL_TOOLS = new Set(['write_file', 'run_command'])

const createExecutor = (workdir: string): ToolExecutor => {
  return async (name, input, signal) => {
    const ipcTools = window.yagentDesktop?.tools
    if (!ipcTools) throw new Error('Tool execution not available (requires Electron)')
    if (APPROVAL_TOOLS.has(name)) {
      const ok = await requestApproval({ name, input }, signal)
      if (!ok) throw new Error('用户拒绝了该操作')
    }
    return ipcTools.execute(name, input, workdir)
  }
}

const BASE_SYSTEM =
  '你是 yagent，一个 AI Agent 客户端里的助手。回答简洁、直接，使用用户的语言。' +
  '用户附件保存在应用数据目录（…/projects/<slug>/uploads/<convId>/ 或 …/chats/uploads/<convId>/），消息里若给出「绝对路径」请原样传给 read_file，不要猜测 .yagent/uploads/ 这类相对路径。' +
  '引用网页来源时，在相关句子后插入标签（不要只写裸 [1]）：' +
  '<ref url="完整https地址" title="短标题">一两句摘要</ref>；也可简写 <ref_link>完整https地址</ref_link>。' +
  '同一 URL 可重复标签；客户端会汇总到右栏「搜索」并显示为角标。'

export const harness = new Harness({
  provider: new MissingKeyProvider('尚未配置模型'),
  model: '',
  system: BASE_SYSTEM,
})

/** 从磁盘扫 skills，把 L1 目录写入 system；无桌面端则清空附录 */
export async function syncSkillsIntoHarness(): Promise<{ total: number; invocable: number }> {
  if (!skillsAvailable()) {
    harness.configure({ system: BASE_SYSTEM })
    return { total: 0, invocable: 0 }
  }
  try {
    const skills = await listSkills()
    harness.configure({
      system: BASE_SYSTEM + formatSkillsSystemAppendix(skills),
    })
    return {
      total: skills.length,
      invocable: skills.filter((s) => !s.disableModelInvocation).length,
    }
  } catch {
    harness.configure({ system: BASE_SYSTEM })
    return { total: 0, invocable: 0 }
  }
}

/** 根据会话工作目录 + 工具开关动态配置工具：
 *  fetch_url / read_file / load_skill 始终可用（桌面端）；search_web 跟随设置；
 *  write_file / run_command 需绑定目录。 */
export function updateToolsFor(convId: string, toolFlags?: Settings['tools']): void {
  const conv = harness.getConversation(convId)
  if (!conv) return
  const workdir = conv.workdir?.trim() ?? ''
  const canSkills = skillsAvailable()
  const tools = DEFAULT_TOOLS.filter((t) => {
    if (t.name === 'load_skill') return canSkills
    if (t.name === 'fetch_url' || t.name === 'read_file') return true
    if (t.name === 'search_web') return toolFlags?.webSearch ?? true
    return !!workdir
  })
  harness.configure({ tools, executor: createExecutor(workdir) })
}

/** 设置 / 当前模型变化时调用，下一条消息生效 */
export function configureHarness(model: ModelConfig | undefined): void {
  harness.configure({
    provider: resolveProvider(model),
    model: model?.modelId ?? '',
    contextLimit: model?.context ?? 128_000,
  })
}

/* ---------- 连通性测试（模型配置页，按模型条目测） ---------- */

/** 真发一次 GET /models 验证连通；成功返回耗时文案，失败抛出可读错误 */
export async function testConnection(model: ModelConfig): Promise<string> {
  let url: string
  let headers: Record<string, string>
  if (keyHasBadChars(model.apiKey) || keyHasBadChars(model.baseURL)) {
    throw new Error('密钥含非法字符（可能粘贴时带入了空格、换行或全角字符），请重新粘贴')
  }
  const key = effectiveKey(model)
  switch (model.provider) {
    case 'anthropic': {
      if (!key) throw new Error('未填写密钥')
      url = 'https://api.anthropic.com/v1/models'
      headers = {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
      break
    }
    case 'openai': {
      if (!key) throw new Error('未填写密钥')
      url = 'https://api.openai.com/v1/models'
      headers = { authorization: `Bearer ${key}` }
      break
    }
    case 'deepseek': {
      if (!key) throw new Error('未填写密钥')
      url = `${DEEPSEEK_BASE_URL}/models`
      headers = { authorization: `Bearer ${key}` }
      break
    }
    case 'custom': {
      const base = cleanKey(model.baseURL).replace(/\/+$/, '')
      if (!base || !key) throw new Error('端点或密钥未填完整')
      url = `${base}/models`
      headers = { authorization: `Bearer ${key}` }
      break
    }
    default:
      throw new Error(`未知 provider：${model.provider}`)
  }

  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  } catch (err) {
    throw new Error(`网络不可达：${err instanceof Error ? err.message : String(err)}`)
  }
  const ms = Date.now() - t0
  if (!res.ok) {
    throw new Error(res.status === 401 ? '密钥无效（401）' : `HTTP ${res.status}`)
  }
  return `${ms}ms`
}

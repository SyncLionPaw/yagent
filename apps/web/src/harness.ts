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
  saveInsightToolDef,
  type ToolExecutor,
} from '@yagent/core'
import type { ChatRequest, ModelConfig, ModelProvider, Settings, StreamEvent } from '@yagent/core'
import { requestApproval } from './approval'
import {
  formatAskUserResult,
  parseAskUserInput,
  requestAskUserQuestion,
} from './askUserQuestion'
import {
  formatInsightResult,
  parseInsightInput,
  requestSaveInsight,
} from './insights'
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

/** 解析工具落点：用户工作区优先；纯 chat 用本机进程隔离沙箱目录 */
async function resolveToolRoot(userWorkdir: string, convId: string): Promise<string> {
  const wd = userWorkdir.trim()
  if (wd) return wd
  const ensure = window.yagentDesktop?.sandbox?.ensure
  if (!ensure) throw new Error('沙箱不可用（需要桌面端）')
  const info = await ensure(convId)
  if (!info?.root) throw new Error('无法创建会话沙箱')
  return info.root
}

const createExecutor = (userWorkdir: string): ToolExecutor => {
  return async (name, input, signal, conv) => {
    // 问答 / 收获只走渲染层，不依赖桌面 IPC
    if (name === 'ask_user_question') {
      const req = parseAskUserInput(input)
      try {
        const answers = await requestAskUserQuestion(req, signal)
        return formatAskUserResult(req, answers)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg === 'aborted' || /取消|跳过|cancel/i.test(msg)) {
          throw new Error('用户跳过了问答')
        }
        throw err
      }
    }
    if (name === 'save_insight') {
      const draft = parseInsightInput(input)
      const insight = await requestSaveInsight({ ...draft, convId: conv.id }, signal)
      return formatInsightResult(insight)
    }
    const ipcTools = window.yagentDesktop?.tools
    if (!ipcTools) throw new Error('Tool execution not available (requires Electron)')
    if (APPROVAL_TOOLS.has(name)) {
      const ok = await requestApproval({ name, input }, signal)
      if (!ok) throw new Error('用户拒绝了该操作')
    }
    const root = await resolveToolRoot(userWorkdir, conv.id)
    return ipcTools.execute(name, input, root)
  }
}

const BASE_SYSTEM =
  '你是 yagent，一个以人为本的 AI Agent：做完事之外，还帮用户多懂一点。回答简洁、直接，使用用户的语言。' +
  '用户附件保存在应用数据目录（…/projects/<slug>/uploads/<convId>/ 或 …/chats/uploads/<convId>/），消息里若给出「绝对路径」请原样传给 read_file，不要猜测 .yagent/uploads/ 这类相对路径。' +
  '引用网页来源时，在相关句子后插入标签（不要只写裸 [1]）：' +
  '<ref url="完整https地址" title="短标题">一两句摘要</ref>；也可简写 <ref_link>完整https地址</ref_link>。' +
  '同一 URL 可重复标签；客户端会汇总到右栏「搜索」并显示为角标。'

const CHAT_SANDBOX_SYSTEM =
  '当前是纯对话（未绑定用户项目）：read_file / write_file / run_command 落在本机「进程隔离」会话沙箱（仅 cwd 隔离的子进程，不是 Docker）。' +
  '写入的文件会出现在右栏「Agent 产物」；不要假设能访问用户磁盘其它路径。'

const INSIGHT_SYSTEM =
  '有对用户真正有用、且其可能还不知道的点时，可用 save_insight 写入右侧「收获」：本轮可以是 0 条、1 条或若干条，没有硬性数量；有就记、没有就不硬写。每条尽量拆细（一次调用只写一个小点），多点就多次调用，正文优先一句话。不要记任务进度或废话。'

/** 灵感总开关；关闭时不注入提示、不挂 save_insight */
let insightEnabled = false

/** 用户在设置「灵感」里填的关键词，注入 system + save_insight */
let insightKeywords: string[] = []

/** skills L1 附录缓存；与远程降级 reminder 一起拼进 system */
let skillsAppendixCache = ''

/** SSH 不可达时注入的系统提醒（空串 = 正常） */
let remoteOfflineReminder = ''

/** 纯 chat 时注入沙箱说明（有用户 workdir 时为空） */
let chatSandboxReminder = ''

/** 远程依赖工具名：SSH 离线时从工具列表拿掉 */
const REMOTE_DEP_TOOLS = new Set(['read_file', 'write_file', 'run_command'])

export function setInsightEnabled(enabled: boolean): void {
  insightEnabled = enabled
}

export function setInsightKeywords(keywords: string[] | undefined): void {
  insightKeywords = (keywords ?? []).map((k) => k.trim()).filter(Boolean)
}

function buildSystem(): string {
  let s = BASE_SYSTEM
  if (insightEnabled) {
    s += INSIGHT_SYSTEM
    if (insightKeywords.length > 0) {
      s += `用户「灵感」关键词（save_insight 的 category 必须取其一）：${insightKeywords.join('、')}。只在有实质、用户可能还不知道的要点时写入，勿硬凑。`
    }
  }
  s += skillsAppendixCache
  if (chatSandboxReminder) s += chatSandboxReminder
  if (remoteOfflineReminder) s += remoteOfflineReminder
  return s
}

function pushSystem(): void {
  harness.configure({ system: buildSystem() })
}

/**
 * SSH 探测中 / 不可达：写入 system reminder，并与 updateToolsFor({ remoteOffline }) 配套。
 * host 仅用于文案；degraded=false 时清掉提醒。
 */
export function setRemoteToolsDegraded(
  degraded: boolean,
  host?: string,
  phase?: 'checking' | 'fail' | null,
): void {
  if (!degraded) {
    if (!remoteOfflineReminder) return
    remoteOfflineReminder = ''
    pushSystem()
    return
  }
  const where = host?.trim() ? `「${host.trim()}」` : '当前绑定主机'
  const head =
    phase === 'checking'
      ? `[系统提醒 · 远程探测中] 正在确认远程主机 ${where} 是否可达。`
      : `[系统提醒 · 远程离线] 无法连接远程主机 ${where}。`
  remoteOfflineReminder =
    `\n\n${head}` +
    '在确认可用前，本轮已暂时移除 read_file / write_file / run_command；远程工作区不可读写，也不能执行命令。' +
    '请只做不依赖该主机的对话、推理与（若仍可用的）网络检索；不要声称已访问、修改或运行了远程环境中的内容。' +
    '主机恢复连通后工具会重新可用。'
  pushSystem()
}

export const harness = new Harness({
  provider: new MissingKeyProvider('尚未配置模型'),
  model: '',
  system: buildSystem(),
})

/** 从磁盘扫 skills，把 L1 目录写入 system；无桌面端则清空附录 */
export async function syncSkillsIntoHarness(): Promise<{ total: number; invocable: number }> {
  if (!skillsAvailable()) {
    skillsAppendixCache = ''
    pushSystem()
    return { total: 0, invocable: 0 }
  }
  try {
    const skills = await listSkills()
    skillsAppendixCache = formatSkillsSystemAppendix(skills)
    pushSystem()
    return {
      total: skills.length,
      invocable: skills.filter((s) => !s.disableModelInvocation).length,
    }
  } catch {
    skillsAppendixCache = ''
    pushSystem()
    return { total: 0, invocable: 0 }
  }
}

/** 根据会话工作目录 + 工具开关动态配置工具：
 *  fetch_url / ask_user_question / load_skill 始终可用；
 *  read_file 默认可；SSH 离线时与 write_file / run_command 一并拿掉；
 *  save_insight 跟随灵感开关；search_web 跟随设置；
 *  write_file / run_command：绑定用户目录，或纯 chat 的进程隔离沙箱。 */
export function updateToolsFor(
  convId: string,
  toolFlags?: Settings['tools'],
  opts?: { remoteOffline?: boolean },
): void {
  const conv = harness.getConversation(convId)
  if (!conv) return
  const workdir = conv.workdir?.trim() ?? ''
  const chatSandbox = !workdir
  const remoteOffline = !!opts?.remoteOffline
  const canSkills = skillsAvailable()
  const nextChatReminder = chatSandbox ? `\n\n${CHAT_SANDBOX_SYSTEM}` : ''
  if (nextChatReminder !== chatSandboxReminder) {
    chatSandboxReminder = nextChatReminder
    pushSystem()
  }
  const tools = DEFAULT_TOOLS.filter((t) => {
    if (remoteOffline && REMOTE_DEP_TOOLS.has(t.name)) return false
    if (t.name === 'load_skill') return canSkills
    if (t.name === 'save_insight') return insightEnabled
    if (
      t.name === 'fetch_url' ||
      t.name === 'read_file' ||
      t.name === 'ask_user_question'
    ) {
      return true
    }
    if (t.name === 'search_web') return toolFlags?.webSearch ?? true
    // 用户项目 或 纯 chat 沙箱
    if (t.name === 'write_file' || t.name === 'run_command') return chatSandbox || !!workdir
    return !!workdir
  }).map((t) => (t.name === 'save_insight' ? saveInsightToolDef(insightKeywords) : t))
  harness.configure({ tools, executor: createExecutor(workdir) })
  // 纯 chat：预热沙箱目录（不阻塞；失败时工具调用再 ensure）
  if (chatSandbox) {
    void window.yagentDesktop?.sandbox?.ensure(convId).catch(() => undefined)
  }
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

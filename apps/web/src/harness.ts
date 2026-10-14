/* ============ Web 端 Harness 单例 + provider 装配 ============
 * provider 选择：设置里的当前模型 → 按 provider 字段选 Anthropic / OpenAI 兼容端点 + 对应 key。
 * 本期不接工具执行（不传 executor，tool_use 走 "tool not available" 降级，符合预期）。
 * DeepSeek 直连（其 API 支持浏览器 CORS，已验证 preflight）；dev 下未填 key 时
 * 回退到 vite 注入的 DEV_DEEPSEEK_KEY（见 vite.config.ts，仅 dev server 注入）。
 */

import {
  AnthropicProvider,
  Harness,
  OpenAIProvider,
} from '@yagent/core'
import type { ChatRequest, ModelConfig, ModelProvider, Settings, StreamEvent } from '@yagent/core'

type ApiKeys = Settings['apiKeys']

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

const BAD_KEY_MSG = 'API Key 含非法字符（可能粘贴时带入了空格、换行或全角字符），请在 设置 → API 密钥 中重新粘贴'

/** dev 预填的 DeepSeek key（生产为空串） */
export function devDeepseekKey(): string {
  return cleanKey(import.meta.env.DEV_DEEPSEEK_KEY as string | undefined)
}

/** DeepSeek 有效 key：设置优先，dev 预填兜底 */
export function effectiveDeepseekKey(keys: ApiKeys): string {
  return cleanKey(keys.deepseek) || devDeepseekKey()
}

export function hasKeyFor(model: ModelConfig, keys: ApiKeys): boolean {
  switch (model.provider) {
    case 'anthropic':
      return !!cleanKey(keys.anthropic)
    case 'openai':
      return !!cleanKey(keys.openai)
    case 'deepseek':
      return !!effectiveDeepseekKey(keys)
    case 'custom':
      return !!cleanKey(keys.customEndpoint) && !!cleanKey(keys.customKey)
    default:
      return false
  }
}

/** 初始模型：默认模型有 key 用默认；否则选第一个有 key 的（dev 下通常是 DeepSeek） */
export function pickInitialModel(models: ModelConfig[], keys: ApiKeys): string {
  const def = models.find((m) => m.isDefault) ?? models[0]
  if (def && hasKeyFor(def, keys)) return def.id
  const usable = models.find((m) => hasKeyFor(m, keys))
  return (usable ?? def)?.id ?? ''
}

/** 脱敏显示：sk-•••ab12（头 3 + 尾 4） */
export function maskKey(key: string): string {
  const t = key.trim()
  if (t.length <= 7) return '••••'
  return `${t.slice(0, 3)}•••${t.slice(-4)}`
}

/* ---------- provider 装配 ---------- */

export function resolveProvider(model: ModelConfig | undefined, keys: ApiKeys): ModelProvider {
  if (!model) return new MissingKeyProvider('尚未选择模型')
  const badKey = (raw: string | undefined) => keyHasBadChars(raw)
  switch (model.provider) {
    case 'anthropic': {
      if (badKey(keys.anthropic)) return new MissingKeyProvider(BAD_KEY_MSG)
      const key = cleanKey(keys.anthropic)
      return key
        ? new AnthropicProvider({ apiKey: key })
        : new MissingKeyProvider('未配置 Anthropic API Key，请在 设置 → API 密钥 中填写')
    }
    case 'openai': {
      if (badKey(keys.openai)) return new MissingKeyProvider(BAD_KEY_MSG)
      const key = cleanKey(keys.openai)
      return key
        ? new OpenAIProvider({ apiKey: key })
        : new MissingKeyProvider('未配置 OpenAI API Key，请在 设置 → API 密钥 中填写')
    }
    case 'deepseek': {
      if (badKey(keys.deepseek)) return new MissingKeyProvider(BAD_KEY_MSG)
      const key = effectiveDeepseekKey(keys)
      return key
        ? new OpenAIProvider({ apiKey: key, baseURL: DEEPSEEK_BASE_URL })
        : new MissingKeyProvider('未配置 DeepSeek API Key，请在 设置 → API 密钥 中填写')
    }
    case 'custom': {
      const baseURL = cleanKey(keys.customEndpoint).replace(/\/+$/, '')
      const key = cleanKey(keys.customKey)
      if (badKey(keys.customEndpoint) || badKey(keys.customKey)) return new MissingKeyProvider(BAD_KEY_MSG)
      return baseURL && key
        ? new OpenAIProvider({ apiKey: key, baseURL })
        : new MissingKeyProvider('自定义端点未填完整（端点 + Key），请在 设置 → API 密钥 中填写')
    }
    default:
      return new MissingKeyProvider(`未知 provider：${model.provider}`)
  }
}

/* ---------- 单例 ---------- */

export const harness = new Harness({
  provider: new MissingKeyProvider('尚未配置模型'),
  model: '',
  system: '你是 yagent，一个 AI Agent 客户端里的助手。回答简洁、直接，使用用户的语言。',
})

/** 设置 / 当前模型变化时调用，下一条消息生效 */
export function configureHarness(model: ModelConfig | undefined, keys: ApiKeys): void {
  harness.configure({ provider: resolveProvider(model, keys), model: model?.modelId ?? '' })
}

/* ---------- 连通性测试（BYOK 设置页） ---------- */

export type TestTarget = 'anthropic' | 'openai' | 'deepseek' | 'custom'

/** 真发一次 GET /models 验证连通；成功返回耗时文案，失败抛出可读错误 */
export async function testConnection(target: TestTarget, keys: ApiKeys): Promise<string> {
  let url: string
  let headers: Record<string, string>
  const keyOf = (raw: string | undefined): string => {
    if (keyHasBadChars(raw)) throw new Error('密钥含非法字符（可能粘贴时带入了空格、换行或全角字符），请重新粘贴')
    return cleanKey(raw)
  }
  switch (target) {
    case 'anthropic': {
      const key = keyOf(keys.anthropic)
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
      const key = keyOf(keys.openai)
      if (!key) throw new Error('未填写密钥')
      url = 'https://api.openai.com/v1/models'
      headers = { authorization: `Bearer ${key}` }
      break
    }
    case 'deepseek': {
      const key = keys.deepseek?.trim() ? keyOf(keys.deepseek) : devDeepseekKey()
      if (!key) throw new Error('未填写密钥')
      url = `${DEEPSEEK_BASE_URL}/models`
      headers = { authorization: `Bearer ${key}` }
      break
    }
    case 'custom': {
      const base = keyOf(keys.customEndpoint).replace(/\/+$/, '')
      const key = keyOf(keys.customKey)
      if (!base || !key) throw new Error('端点或密钥未填完整')
      url = `${base}/models`
      headers = { authorization: `Bearer ${key}` }
      break
    }
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

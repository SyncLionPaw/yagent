import { createBingWebProvider } from './bing'
import { createDeepSeekWebProvider } from './deepseek'
import type { WebContentProvider, WebContentProviderId, WebContentResolveInput } from './types'

export type { WebContentProvider, WebContentProviderId, WebContentResolveInput }

/** 按设置解析 search/fetch 后端；缺省 / 未知 → bing */
export function resolveWebContentProvider(input: WebContentResolveInput): WebContentProvider {
  const id = (input.provider ?? 'bing') as WebContentProviderId
  if (id === 'deepseek') {
    const key = (input.deepseekApiKey ?? '').trim()
    if (!key) {
      throw new Error(
        '网络内容后端为 DeepSeek，但未找到可用的 DeepSeek API Key（请在 设置 → 模型配置 中填写 DeepSeek 密钥）',
      )
    }
    return createDeepSeekWebProvider({
      apiKey: key,
      baseURL: input.deepseekBaseURL ?? undefined,
    })
  }
  return createBingWebProvider()
}

/** 从 settings.json 解析出的松散对象里取 DeepSeek key（优先带 key 的 deepseek 模型） */
export function pickDeepSeekKeyFromSettings(settings: {
  models?: Array<{ provider?: string; apiKey?: string; baseURL?: string }>
}): { apiKey: string; baseURL?: string } | null {
  const models = settings.models ?? []
  const hit = models.find((m) => m.provider === 'deepseek' && (m.apiKey ?? '').trim())
  if (!hit) return null
  return { apiKey: hit.apiKey!.trim(), baseURL: hit.baseURL?.trim() || undefined }
}

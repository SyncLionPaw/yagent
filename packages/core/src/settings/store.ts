/* ============ 设置 Store：加载 / 合并迁移 / 保存（Claude 风格格式化） ============ */

import type { ModelConfig, Settings } from '../model.js'
import type { SettingsStorage } from './storage.js'

// 合并迁移：模型列表按 id 合并（saved 里缺的默认条目补上），tools/sandbox 浅合并，其余 saved 覆盖 defaults；
// 旧版顶层 apiKeys 迁移进对应 provider 的模型条目（仅当模型自身没填 key）
export function mergeSettings(defaults: Settings, saved: Partial<Settings>): Settings {
  const legacyKeys = (saved as { apiKeys?: Record<string, string | undefined> }).apiKeys
  const migrateKey = (m: ModelConfig): ModelConfig => {
    if (!legacyKeys || m.apiKey) return m
    if (m.provider === 'custom') {
      const baseURL = legacyKeys.customEndpoint
      const apiKey = legacyKeys.customKey
      return baseURL || apiKey ? { ...m, baseURL: baseURL || m.baseURL, apiKey: apiKey || m.apiKey } : m
    }
    const key = legacyKeys[m.provider]
    return key ? { ...m, apiKey: key } : m
  }
  const models = [...(saved.models ?? [])].map(migrateKey).map((m) => {
    // DeepSeek 官方上下文为 1M；旧默认 128k 自动抬升
    // https://api-docs.deepseek.com/zh-cn/quick_start/pricing
    if (m.provider === 'deepseek' && (m.context === 128_000 || !m.context)) {
      return { ...m, context: 1_000_000 }
    }
    return m
  })
  for (const m of defaults.models) {
    if (!models.some((s) => s.id === m.id)) models.push(m)
  }
  // 旧字段 apiKeys 不带进结果，避免再次落盘
  const { apiKeys: _drop, ...rest } = saved as Partial<Settings> & { apiKeys?: unknown }
  const appearance = { ...defaults.appearance, ...saved.appearance }
  // 青瓷白已替换为枫红
  if ((appearance.accent as string | undefined) === 'celadon-white') {
    appearance.accent = 'maple-red'
  }
  return {
    ...defaults,
    ...rest,
    models: models.length ? models : defaults.models,
    tools: { ...defaults.tools, ...saved.tools },
    sandbox: { ...defaults.sandbox, ...saved.sandbox },
    appearance,
    user: { ...defaults.user, ...saved.user },
    knowledgeBases: {
      sources: saved.knowledgeBases?.sources ?? defaults.knowledgeBases?.sources ?? [],
    },
  }
}

export class SettingsStore {
  private current: Settings

  constructor(
    private storage: SettingsStorage,
    private defaults: Settings,
  ) {
    this.current = defaults
  }

  async load(): Promise<Settings> {
    const raw = await this.storage.read()
    if (raw === null) return this.current
    try {
      this.current = mergeSettings(this.defaults, JSON.parse(raw) as Partial<Settings>)
    } catch {
      // 损坏文件回退当前值，不覆写磁盘，下次显式 save 才写
    }
    return this.current
  }

  get(): Settings {
    return this.current
  }

  async save(settings: Settings): Promise<void> {
    this.current = settings
    await this.storage.write(JSON.stringify(settings, null, 2) + '\n')
  }
}

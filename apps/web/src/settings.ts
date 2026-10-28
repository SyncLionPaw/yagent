import { SettingsStore, type Settings, type SettingsStorage } from '@yagent/core'

const SETTINGS_KEY = 'yagent-settings'

/** 无本地配置时的出厂默认（无演示记忆 / 昵称；模型条目仅作空壳，密钥由用户填写） */
export const DEFAULT_SETTINGS: Settings = {
  models: [
    {
      id: 'm-claude',
      name: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      context: 200_000,
    },
    {
      id: 'm-gpt',
      name: 'GPT-5 mini',
      provider: 'openai',
      modelId: 'gpt-5-mini',
      context: 128_000,
    },
    {
      id: 'm-deepseek',
      name: 'DeepSeek Flash',
      provider: 'deepseek',
      modelId: 'deepseek-flash',
      context: 1_000_000,
      isDefault: true,
    },
  ],
  memories: [],
  inspiration: { keywords: [] },
  tools: {
    terminal: true,
    fileEdit: true,
    webSearch: true,
    approvalMode: 'ask',
    autoApprove: false,
    webProvider: 'bing',
  },
  sandbox: { env: 'sandbox', workdir: '', network: true },
  appearance: {
    accent: 'violet',
    contentWidth: 'standard',
    sidebarWidth: 236,
    panelWidth: 288,
  },
  user: {},
  knowledgeBases: { sources: [] },
}

// Electron 走 IPC 配置文件，纯浏览器继续 localStorage（key 不变，读写失败静默）
function createSettingsStorage(): SettingsStorage {
  const ipc = window.yagentDesktop?.settings
  if (ipc) {
    return {
      async read() {
        const content = await ipc.read()
        if (content !== null) return content
        // 一次性迁移：配置文件不存在但 localStorage 有旧数据时返回旧数据，下次 save 自然落盘
        try {
          return localStorage.getItem(SETTINGS_KEY)
        } catch {
          return null
        }
      },
      write(content) {
        return ipc.write(content)
      },
    }
  }
  return {
    async read() {
      try {
        return localStorage.getItem(SETTINGS_KEY)
      } catch {
        return null
      }
    },
    async write(content) {
      try {
        localStorage.setItem(SETTINGS_KEY, content)
      } catch {
        // 隐私模式等写失败忽略
      }
    },
  }
}

export const settingsStore = new SettingsStore(createSettingsStorage(), DEFAULT_SETTINGS)

import type { Settings } from '@yagent/core'

/** 旧版误用 localStorage 的自动执行开关；读一次后清除 */
const LEGACY_AUTO_APPROVE_KEY = 'yagent-auto-approve'

/** 启动时一次性迁移；返回可能被改写的 settings */
export function migrateLoadedSettings(s: Settings): Settings {
  try {
    const legacy = localStorage.getItem(LEGACY_AUTO_APPROVE_KEY)
    if (legacy === null) return s
    localStorage.removeItem(LEGACY_AUTO_APPROVE_KEY)
    return {
      ...s,
      tools: { ...s.tools, autoApprove: legacy === '1' || !!s.tools.autoApprove },
    }
  } catch {
    return s
  }
}

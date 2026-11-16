import type { Settings } from '@yagent/core'

/** 设置侧栏 / 翻页 pane id（与 SettingsPanel 解耦，避免主包拉入整页） */
export type SettingsPaneId =
  | 'user'
  | 'models'
  | 'appearance'
  | 'skills'
  | 'inspiration'
  | 'knowledge'
  | 'tools'
  | 'connectors'
  | 'storage'

export function userNickname(settings: Settings): string {
  const n = settings.user?.nickname?.trim()
  return n || '用户'
}

export function userAvatarLetter(settings: Settings): string {
  const n = userNickname(settings)
  return Array.from(n)[0]?.toUpperCase() ?? 'U'
}

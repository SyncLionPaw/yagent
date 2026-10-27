/* ============ Slash 命令：输入 /name 发送时本地执行，不进模型 ============ */

import { skillsAvailable } from './skills'
import { syncSkillsIntoHarness } from './harness'

export type SlashCommand = {
  /** 不含斜杠，如 reload_skill */
  name: string
  description: string
  run: () => Promise<{ ok: boolean; message: string }>
}

/** 压缩当前会话上下文；暂未实现，仅占位 */
export async function compactContext(_convId?: string): Promise<void> {
  // TODO: 裁剪 / 摘要历史消息后写回会话
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'reload_skill',
    description: '重新扫描技能目录，刷新 system 中的技能目录（L1）',
    run: async () => {
      if (!skillsAvailable()) {
        return { ok: false, message: '技能仅桌面端可用' }
      }
      try {
        const { total, invocable } = await syncSkillsIntoHarness()
        return {
          ok: true,
          message: `已重载技能：共 ${total} 个（${invocable} 个可自动调用）`,
        }
      } catch (err) {
        return {
          ok: false,
          message: `重载失败：${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
  },
  {
    name: 'compact',
    description: '压缩当前会话上下文（暂未实现）',
    run: async () => {
      await compactContext()
      return { ok: true, message: '/compact：上下文压缩尚未实现，稍后接入' }
    },
  },
]

/** 整行恰好是 `/name`（可尾随空白）时命中；未知命令返回 null */
export function matchSlashCommand(text: string): SlashCommand | null {
  const m = text.trim().match(/^\/([a-zA-Z0-9_-]+)\s*$/)
  if (!m) return null
  return SLASH_COMMANDS.find((c) => c.name === m[1]) ?? null
}

/** 输入框以 `/` 开头且尚无空格时，用于补全菜单；返回 `/` 后的前缀 */
export function slashMenuQuery(draft: string): string | null {
  if (!draft.startsWith('/') || draft.includes('\n')) return null
  const rest = draft.slice(1)
  if (rest.includes(' ')) return null
  return rest
}

export function filterSlashCommands(prefix: string): SlashCommand[] {
  const q = prefix.toLowerCase()
  if (!q) return SLASH_COMMANDS
  // 已完整命中某命令时收起菜单，避免 Enter 补全后还挂着一项
  if (SLASH_COMMANDS.some((c) => c.name.toLowerCase() === q)) return []
  return SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(q))
}

/** 未知 `/foo`：给用户提示，仍不送模型 */
export function unknownSlashMessage(text: string): string | null {
  const m = text.trim().match(/^\/([a-zA-Z0-9_-]+)\s*$/)
  if (!m) return null
  if (SLASH_COMMANDS.some((c) => c.name === m[1])) return null
  const names = SLASH_COMMANDS.map((c) => `/${c.name}`).join('、')
  return `未知命令 /${m[1]}。可用：${names || '（暂无）'}`
}

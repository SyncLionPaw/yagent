/* ============ Skills：渐进披露（L1 目录 / L2–L3 经 load_skill） ============ */

import type { ToolDef } from '../providers/types.js'

/** 技能目录项（L1：仅 id / name / description 进 system） */
export type SkillCatalogEntry = {
  id: string
  name: string
  description: string
  /** true → 不进 L1 目录，仅用户显式触发时可用（对齐 Claude disable-model-invocation） */
  disableModelInvocation?: boolean
}

/** 加载技能正文或同目录附属文件（L2 / L3） */
export const LOAD_SKILL_TOOL: ToolDef = {
  name: 'load_skill',
  description:
    'Load a skill into context (progressive disclosure). Call when the user task matches an available skill in the system prompt. ' +
    'Pass id from the catalog. Optional file: relative path inside the skill directory (e.g. reference.md or scripts/helper.py) for bundled resources. ' +
    'Omit file to load SKILL.md instructions plus a listing of bundled files.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Skill directory id (from the skills catalog)' },
      file: {
        type: 'string',
        description: 'Optional relative path within the skill directory for Level-3 resources',
      },
    },
    required: ['id'],
  },
}

/** 拼进 system 的 L1 附录；无可自动调用的技能时返回空串 */
export function formatSkillsSystemAppendix(skills: SkillCatalogEntry[]): string {
  const list = skills.filter((s) => !s.disableModelInvocation)
  if (!list.length) return ''
  const lines = list.map((s) => {
    const desc = (s.description || '').trim() || '(no description)'
    return `- \`${s.id}\` (${s.name}): ${desc}`
  })
  return (
    '\n\n## Skills\n' +
    'Skills are specialized instructions loaded on demand. When the user task matches a skill description below, ' +
    'call `load_skill` with that id **before** proceeding; follow the returned instructions. ' +
    'Bundled files listed in the result can be loaded with `load_skill` again, passing `file`.\n' +
    'Available skills:\n' +
    lines.join('\n')
  )
}

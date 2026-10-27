/** 技能目录：桌面端 <dataDir>/skills/（正式 ~/.yagent/skills，--dev 为仓库旁 .yagent/skills） */

export type SkillSummary = {
  id: string
  name: string
  description: string
  path: string
  /** true → 不进 L1 system 目录（对齐 Claude disable-model-invocation） */
  disableModelInvocation?: boolean
}

export type SkillDetail = SkillSummary & {
  body: string
  content: string
}

function ipc() {
  return window.yagentDesktop?.skills
}

export function skillsAvailable(): boolean {
  return !!ipc()
}

export async function skillsRoot(): Promise<string | null> {
  const api = ipc()
  if (!api) return null
  return api.root()
}

export async function listSkills(): Promise<SkillSummary[]> {
  const api = ipc()
  if (!api) return []
  return api.list()
}

export async function readSkill(id: string): Promise<SkillDetail | null> {
  const api = ipc()
  if (!api) return null
  return api.read(id)
}

export async function createSkill(input: {
  name: string
  description?: string
  id?: string
}): Promise<SkillSummary> {
  const api = ipc()
  if (!api) throw new Error('技能管理需要桌面端')
  return api.create(input)
}

export async function writeSkill(id: string, content: string): Promise<SkillSummary> {
  const api = ipc()
  if (!api) throw new Error('技能管理需要桌面端')
  return api.write(id, content)
}

export async function deleteSkill(id: string): Promise<void> {
  const api = ipc()
  if (!api) throw new Error('技能管理需要桌面端')
  return api.delete(id)
}

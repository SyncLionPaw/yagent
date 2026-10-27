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

export type ExternalSkill = SkillSummary & {
  installed: boolean
}

export type ExternalSkillSource = {
  id: string
  label: string
  root: string
  exists: boolean
  skills: ExternalSkill[]
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

export async function scanExternalSkills(): Promise<ExternalSkillSource[]> {
  const api = ipc()
  if (!api?.scanExternal) return []
  const { sources } = await api.scanExternal()
  return sources
}

export async function importExternalSkill(input: {
  sourcePath: string
  id?: string
  overwrite?: boolean
}): Promise<SkillSummary> {
  const api = ipc()
  if (!api?.importExternal) throw new Error('技能迁移需要桌面端')
  return api.importExternal(input)
}

export async function importSkillZip(input: {
  zipPath?: string
  zipBase64?: string
  fileName?: string
  overwrite?: boolean
}): Promise<SkillSummary[]> {
  const api = ipc()
  if (!api?.importZip) throw new Error('技能 zip 导入需要桌面端')
  return api.importZip(input)
}

export async function pickAndImportSkills(): Promise<{
  imported: SkillSummary[]
  canceled: boolean
  errors?: string[]
}> {
  const api = ipc()
  if (!api?.pickAndImport) throw new Error('技能上传需要桌面端')
  return api.pickAndImport()
}

export function pathForDroppedFile(file: File): string {
  return window.yagentDesktop?.pathForFile?.(file) || ''
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 拖放导入：优先本地路径；无路径则把 zip 读成 base64 交给主进程 */
export async function importDroppedSkillFiles(files: File[]): Promise<{
  imported: SkillSummary[]
  errors: string[]
}> {
  const imported: SkillSummary[] = []
  const errors: string[] = []
  for (const file of files) {
    const localPath = pathForDroppedFile(file)
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip'
    try {
      if (localPath && isZip) {
        imported.push(...(await importSkillZip({ zipPath: localPath })))
        continue
      }
      if (localPath && !isZip) {
        // 可能是文件夹被当成文件拖入时无扩展名；目录走 importExternal
        imported.push(await importExternalSkill({ sourcePath: localPath }))
        continue
      }
      if (isZip) {
        const buf = await file.arrayBuffer()
        if (buf.byteLength > 80 * 1024 * 1024) {
          errors.push(`${file.name}: zip 超过 80MB`)
          continue
        }
        imported.push(
          ...(await importSkillZip({
            zipBase64: bufferToBase64(buf),
            fileName: file.name,
          })),
        )
        continue
      }
      errors.push(`${file.name}: 请拖入技能文件夹或 .zip`)
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { imported, errors }
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

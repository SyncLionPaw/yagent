const LS_KEY = 'yagent-projects'

/** 记住项目目录：桌面写 project.json；浏览器落 localStorage。删光会话不注销。 */
export async function rememberProject(workdir: string): Promise<void> {
  const wd = workdir.trim()
  if (!wd) return
  const ipc = window.yagentDesktop?.projects
  if (ipc) {
    await ipc.remember(wd).catch(() => undefined)
    return
  }
  try {
    const list = readLocal()
    if (!list.includes(wd)) {
      list.unshift(wd)
      localStorage.setItem(LS_KEY, JSON.stringify(list))
    }
  } catch {
    // 配额等
  }
}

export async function listProjects(): Promise<string[]> {
  const ipc = window.yagentDesktop?.projects
  if (ipc) {
    try {
      return await ipc.list()
    } catch {
      return []
    }
  }
  return readLocal()
}

/** 从侧栏移除空项目登记（不删用户仓库） */
export async function forgetProject(workdir: string): Promise<void> {
  const wd = workdir.trim()
  if (!wd) return
  const ipc = window.yagentDesktop?.projects
  if (ipc) {
    await ipc.forget(wd).catch(() => undefined)
    return
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(readLocal().filter((x) => x !== wd)))
  } catch {
    //
  }
}

function readLocal(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  } catch {
    return []
  }
}

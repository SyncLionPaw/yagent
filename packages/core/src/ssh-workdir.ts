/* ============ 远程（SSH）工作目录标识 ============
 * workdir 字符串用 `ssh://<host>/<path>` 形式表示远程项目；
 * 普通绝对路径表示本地项目。执行后端暂只支持本地。
 */

export function isSshWorkdir(workdir: string | null | undefined): boolean {
  return typeof workdir === 'string' && workdir.startsWith('ssh://')
}

export interface SshWorkdir {
  /** ssh config 里的 Host 别名，或 user@host */
  host: string
  /** 远程绝对路径（前导 / 保留） */
  path: string
}

/** 解析 ssh://workdir；非 ssh 返回 null。URI 形如 ssh://host/<path>，开头 /~ 还原为 ~ */
export function parseSshWorkdir(workdir: string | null | undefined): SshWorkdir | null {
  if (!isSshWorkdir(workdir)) return null
  const rest = (workdir as string).slice('ssh://'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return { host: rest, path: '/' }
  const host = rest.slice(0, slash)
  const raw = rest.slice(slash) || '/'
  // 以 /~/ 或 /~ 开头 → 远程 home 相对路径（~/... 或 ~）；其余按绝对路径
  if (raw === '/~') return { host, path: '~' }
  if (raw.startsWith('/~/')) return { host, path: `~/${raw.slice(3)}` }
  return { host, path: raw }
}

/** 组装 ssh://workdir。~ / ~/ 前缀编成 ssh://host/~/...；绝对路径原样；相对路径补 / */
export function formatSshWorkdir(host: string, path: string): string {
  const p = path.trim()
  let body: string
  if (p === '~') body = '/~'
  else if (p.startsWith('~/')) body = `/~/${p.slice(2)}`
  else if (p.startsWith('/')) body = p
  else body = `/${p}`
  return `ssh://${host.trim()}${body}`
}

/** 项目展示名：本地取末级目录名；远程取 host（host:path 末级更直观时用路径末级） */
export function projectDisplayName(workdir: string): string {
  const ssh = parseSshWorkdir(workdir)
  if (ssh) {
    const base = ssh.path.split('/').filter(Boolean).pop()
    return base ? `${ssh.host}:${base}` : ssh.host
  }
  return workdir.split('/').filter(Boolean).pop() ?? workdir
}

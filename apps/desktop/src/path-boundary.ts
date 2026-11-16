import { realpath } from 'node:fs/promises'
import path from 'node:path'

function assertInside(base: string, target: string): void {
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error('Path is outside the bound working directory')
  }
}

/**
 * 解析工作区内路径。目标可不存在，但最近存在的父目录必须真实位于 root 内，
 * 防止通过 root/link -> /outside 的符号链接写入 link/new-file。
 */
export async function resolveInside(
  root: string,
  relativePath: string,
  allowMissing = false,
): Promise<string> {
  const base = await realpath(root)
  const target = path.resolve(base, relativePath)
  assertInside(base, target)

  try {
    const actual = await realpath(target)
    assertInside(base, actual)
    return actual
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!allowMissing || code !== 'ENOENT') throw error
  }

  // 从新文件逐级向上找最近存在的祖先；每级都解析符号链接并检查边界
  const missing: string[] = []
  let ancestor = target
  for (;;) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) throw new Error('Unable to resolve an existing parent directory')
    missing.unshift(path.basename(ancestor))
    ancestor = parent
    try {
      const actualAncestor = await realpath(ancestor)
      assertInside(base, actualAncestor)
      const resolved = path.join(actualAncestor, ...missing)
      assertInside(base, resolved)
      return resolved
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** 供远程 shell 安全内嵌的路径引用；~ 仅展开前缀，其余字符全部按字面量处理 */
export function shq(s: string): string {
  if (s === '~') return '"$HOME"'
  if (s.startsWith('~/')) return `"$HOME"/'${s.slice(2).replace(/'/g, `'\\''`)}'`
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** 远程 cwd + 相对路径拼接；拒绝绝对路径和 .. 逃逸 */
export function sshJoin(cwd: string, rel: string): string {
  const raw = String(rel ?? '').replace(/\\/g, '/')
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error('Absolute paths are not allowed')
  }
  const r = raw.replace(/^\/+|\/+$/g, '')
  if (r.split('/').includes('..')) throw new Error('Path escapes working directory')
  if (!r || r === '.') return cwd
  const base = cwd === '~' ? '~' : cwd.replace(/\/$/, '')
  return `${base}/${r}`
}

/**
 * 远端真实路径边界校验前缀：设置 shell 变量 root / target。
 * realpath -m / readlink -m 可同时解析已有符号链接和尚不存在的末级路径；
 * 远端不支持时 fail closed，而不是退化为不安全的词法检查。
 */
export function sshCanonicalBoundaryPrelude(cwd: string, rel: string): string {
  const target = sshJoin(cwd, rel)
  return [
    `root=$(CDPATH= cd -- ${shq(cwd)} 2>/dev/null && pwd -P) || { echo "Working directory not found" >&2; exit 3; }`,
    `target=$(realpath -m -- ${shq(target)} 2>/dev/null || readlink -m -- ${shq(target)} 2>/dev/null) || { echo "Remote realpath -m or readlink -m is required" >&2; exit 5; }`,
    `case "$target" in "$root"|"\${root%/}"/*) ;; *) echo "Path escapes working directory" >&2; exit 5 ;; esac`,
  ].join('\n')
}

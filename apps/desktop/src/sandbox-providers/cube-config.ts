/* 外部沙箱供应商的配置与路径约定。
 * 设置里的端点优先；没填时才读 providers/cube.json。
 * 执行环境选「本机」则不用外部沙箱。
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface CubeProviderConfig {
  apiUrl: string
  apiKey?: string
  templateId: string
  proxyNodeIp?: string
  proxyPort?: number
  proxyScheme?: string
  sandboxDomain?: string
  /** 沙箱空闲超时（秒） */
  timeout?: number
  /** 相对路径的沙箱内工作目录 */
  workdir: string
  /** 界面上显示的沙箱位置；缺省取 apiUrl 的 host */
  place: string
}

const ROOT_SCHEME = 'cube://'

export function cubeConfigPath(dataDir: string): string {
  return path.join(dataDir, 'providers', 'cube.json')
}

export function cubeSessionPath(dataDir: string, convId: string): string {
  return path.join(dataDir, 'providers', 'cube-sessions', `${convId}.json`)
}

export function cubeRootFor(convId: string): string {
  const id = String(convId ?? '').trim()
  if (!id || /[/\\:]/.test(id) || id.includes('..')) throw new Error('Invalid convId')
  return `${ROOT_SCHEME}${id}`
}

/** 工具 workdir 是否指向这个供应商。不是则返回 null，调用方走原路径。 */
export function parseCubeRoot(root: string): string | null {
  if (!root.startsWith(ROOT_SCHEME)) return null
  const id = root.slice(ROOT_SCHEME.length)
  if (!id || /[/\\]/.test(id) || id.includes('..')) return null
  return id
}

/** 设置优先。选了「本机」就不用外部沙箱。设置没填时才读 providers/cube.json。
 * override 用来让界面按内存里的设置立刻换名字，不必等落盘。 */
export async function loadCubeConfig(
  dataDir: string,
  override?: { env?: string; provider?: Record<string, unknown> } | null,
): Promise<CubeProviderConfig | null> {
  const sandbox = override ?? (await readSettingsSandbox(dataDir))
  if (sandbox?.env === 'local') return null
  const fromSettings = configFromRecord(sandbox?.provider, '设置 → 沙箱')
  if (fromSettings) return fromSettings
  return readCubeFile(dataDir)
}

/** 仅读 providers/cube.json，给设置页回填旧配置。 */
export async function readCubeFile(dataDir: string): Promise<CubeProviderConfig | null> {
  const file = cubeConfigPath(dataDir)
  if (!existsSync(file)) return null
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  if (parsed.enabled === false) return null
  return configFromRecord(parsed, 'providers/cube.json')
}

async function readSettingsSandbox(
  dataDir: string,
): Promise<{ env?: string; provider?: Record<string, unknown> } | null> {
  const file = path.join(dataDir, 'settings.json')
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { sandbox?: { env?: string; provider?: Record<string, unknown> } }
    return parsed.sandbox ?? null
  } catch {
    return null
  }
}

function configFromRecord(parsed: Record<string, unknown> | undefined, source: string): CubeProviderConfig | null {
  if (!parsed) return null
  const apiUrl = stringField(parsed, 'apiUrl')
  const templateId = stringField(parsed, 'templateId')
  if (!apiUrl || !templateId) return null
  const workdir = stringField(parsed, 'workdir') || '/root'
  if (!workdir.startsWith('/')) throw new Error(`${source} 的 workdir 必须是绝对路径`)
  const proxyNodeIp = stringField(parsed, 'proxyNodeIp') || placeFromApiUrl(apiUrl)
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    apiKey: stringField(parsed, 'apiKey') || undefined,
    templateId,
    proxyNodeIp,
    proxyPort: portField(parsed.proxyPort) ?? 80,
    proxyScheme: stringField(parsed, 'proxyScheme') || 'http',
    sandboxDomain: stringField(parsed, 'sandboxDomain') || undefined,
    timeout: positiveField(parsed.timeout),
    workdir,
    place: stringField(parsed, 'label') || placeFromApiUrl(apiUrl),
  }
}

function placeFromApiUrl(apiUrl: string): string {
  try {
    return new URL(apiUrl).hostname || apiUrl
  } catch {
    return apiUrl
  }
}

/** 沙箱内路径。绝对路径以虚拟机为边界；相对路径落在 workdir 下。 */
export function resolveSandboxPath(workdir: string, input: string): string {
  const raw = input.trim()
  if (!raw) throw new Error('path is empty')
  const base = normalizeAbsolute(workdir)
  const abs = raw.startsWith('/') ? normalizeAbsolute(raw) : normalizeAbsolute(`${base}/${raw}`)
  if (!raw.startsWith('/') && abs !== base && !abs.startsWith(`${base}/`)) {
    throw new Error('path escapes sandbox workdir')
  }
  return abs
}

export function pageFileText(file: string, text: string, offset: number, limit: number): string {
  if (text.includes('\0')) throw new Error('Binary file is not supported by read_file')
  const lines = text.split(/\r?\n/)
  const total = lines.length
  if (offset > total) return `File has ${total} lines; offset=${offset} is past the end.`
  const start = offset - 1
  const out: string[] = []
  let chars = 0
  let end = start
  while (end < total && out.length < limit) {
    const formatted = `L${end + 1}: ${lines[end]}`
    if (out.length > 0 && chars + formatted.length + 1 > 80_000) break
    out.push(formatted)
    chars += formatted.length + 1
    end += 1
  }
  const more = end < total
  const head = more
    ? `[PARTIAL] ${file}: lines ${offset}-${end} of ${total}. Next: offset=${end + 1} limit=${limit}`
    : `[OK] ${file}: lines ${offset}-${end} of ${total}`
  return `${head}\n${out.join('\n')}`
}

function normalizeAbsolute(input: string): string {
  const stack: string[] = []
  for (const part of input.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) throw new Error('path escapes sandbox workdir')
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return `/${stack.join('/')}`
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key]
  return typeof value === 'string' ? value.trim() : ''
}

function portField(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('providers/cube.json 的 proxyPort 无效')
  return n
}

function positiveField(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error('providers/cube.json 的 timeout 无效')
  return n
}

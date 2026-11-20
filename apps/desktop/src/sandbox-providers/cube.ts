/* CubeSandbox 适配器。只在 providers/cube.json 存在时被主进程调用。
 * SDK 动态加载，设置、Harness、工具定义都不认识这个供应商。
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shq } from '../path-boundary.js'
import {
  cubeSessionPath,
  loadCubeConfig,
  pageFileText,
  resolveSandboxPath,
  type CubeProviderConfig,
} from './cube-config.js'

export { cubeRootFor, loadCubeConfig, parseCubeRoot, readCubeFile } from './cube-config.js'

const COMMAND_TIMEOUT_MS = 600_000
const SESSION_TIMEOUT_S = 3600

interface CubeSandbox {
  sandboxId: string
  commands: {
    run(
      cmd: string,
      opts?: { cwd?: string; timeoutMs?: number },
    ): Promise<{ stdout?: string; stderr?: string; exitCode?: number }>
  }
  files: {
    read(path: string, opts?: { format?: 'text' | 'bytes' }): Promise<string | Uint8Array>
    write(path: string, data: string | Uint8Array): Promise<unknown>
    stat(path: string): Promise<Record<string, unknown>>
  }
  kill(): Promise<unknown>
}

interface CubeSdk {
  Sandbox: {
    create(options: Record<string, unknown>): Promise<CubeSandbox>
    connect(id: string, options: { config: Record<string, unknown> }): Promise<CubeSandbox>
    health(config?: Record<string, unknown>): Promise<Record<string, unknown>>
  }
}

const live = new Map<string, Promise<CubeSandbox>>()

export async function cubeRunTool(
  dataDir: string,
  convId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const cfg = await requiredConfig(dataDir)
  return callSandbox(dataDir, convId, cfg, async (sb) => {
  if (name === 'run_command') {
    const command = requiredString(input, 'command')
    const result = await sb.commands.run(command, { cwd: cfg.workdir, timeoutMs: COMMAND_TIMEOUT_MS })
    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''
    const code = result.exitCode ?? 1
    return `${stdout}${stderr ? `\n${stderr}` : ''}\n[exit ${code}] (cube)`
  }
  if (name === 'read_file') {
    const file = resolveSandboxPath(cfg.workdir, requiredString(input, 'path'))
    const text = await readText(sb, file)
    const offset = positiveInt(input.offset, 1)
    const limit = positiveInt(input.limit, 2000)
    return pageFileText(file, text, offset, limit)
  }
  if (name === 'write_file') {
    const file = resolveSandboxPath(cfg.workdir, requiredString(input, 'path'))
    const content = requiredString(input, 'content')
    await writeText(sb, file, content)
    const rel = file.startsWith(`${cfg.workdir}/`) ? file.slice(cfg.workdir.length + 1) : file
    return `Wrote ${rel}`
  }
  throw new Error(`Unknown tool: ${name}`)
  })
}

export async function cubePreview(dataDir: string, convId: string, rel: string) {
  const cfg = await requiredConfig(dataDir)
  return callSandbox(dataDir, convId, cfg, async (sb) => {
  const file = resolveSandboxPath(cfg.workdir, rel)
  const ext = path.posix.extname(file).toLowerCase()
  const unavailable = (reason: string, size = 0) => ({ kind: 'unavailable' as const, reason, size })
  const binaryExt = new Set([
    '.pth', '.pt', '.ckpt', '.safetensors', '.bin', '.pkl', '.pickle', '.npy', '.npz',
    '.onnx', '.h5', '.pb', '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.exe', '.dll',
    '.so', '.dylib', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg',
    '.m4a', '.flac', '.mp4', '.mov', '.webm', '.mkv', '.avi',
  ])
  const size = await fileSize(sb, file)
  if (binaryExt.has(ext)) return unavailable('二进制文件不支持预览', size ?? 0)
  const imageMime: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  }
  const mime = imageMime[ext]
  const molecule = new Set(['.xyz', '.pdb', '.sdf', '.mol', '.mol2', '.cif', '.gro', '.pqr']).has(ext)
  const limit = mime
    ? 5 * 1024 * 1024
    : ext === '.pdf'
      ? 10 * 1024 * 1024
      : molecule
        ? 2 * 1024 * 1024
        : ext === '.html' || ext === '.htm' || ext === '.md' || ext === '.markdown'
          ? 512 * 1024
          : 256 * 1024
  if (size !== null && size > limit) {
    return unavailable(mime ? '图片超过 5MB，请在编辑器中打开' : '文件过大，请在编辑器中打开', size)
  }
  if (mime || ext === '.pdf') {
    const bytes = await readBytes(sb, file)
    if (bytes.byteLength > limit) return unavailable('文件过大，请在编辑器中打开', bytes.byteLength)
    const b64 = Buffer.from(bytes).toString('base64')
    if (mime) return { kind: 'image' as const, mime, dataUrl: `data:${mime};base64,${b64}` }
    return { kind: 'pdf' as const, dataUrl: `data:application/pdf;base64,${b64}` }
  }
  const text = await readText(sb, file)
  if (text.includes('\0')) return unavailable('二进制文件不支持预览', size ?? Buffer.byteLength(text))
  if (ext === '.html' || ext === '.htm') return { kind: 'html' as const, content: text }
  if (ext === '.md' || ext === '.markdown') return { kind: 'markdown' as const, content: text }
  if (molecule) return { kind: 'molecule' as const, format: ext.slice(1), content: text }
  return { kind: 'text' as const, content: text }
  })
}

export async function cubeReadBytes(dataDir: string, convId: string, rel: string): Promise<Buffer> {
  const cfg = await requiredConfig(dataDir)
  return callSandbox(dataDir, convId, cfg, async (sb) => {
  const file = resolveSandboxPath(cfg.workdir, rel)
  const bytes = await readBytes(sb, file)
  if (bytes.byteLength > 80 * 1024 * 1024) throw new Error('文件过大（超过 80MB）')
  return Buffer.from(bytes)
  })
}

/** 只问控制面是否通，不创建沙箱。没配外部沙箱时本机进程始终可用。 */
export async function cubePing(
  dataDir: string,
  override?: { env?: string; provider?: Record<string, unknown> } | null,
): Promise<{ mode: 'local' | 'remote'; ok: boolean; label: string; error?: string }> {
  const cfg = await loadCubeConfig(dataDir, override)
  if (!cfg) return { mode: 'local', ok: true, label: '本机' }
  try {
    const { Sandbox } = await loadSdk()
    await Sandbox.health({
      apiUrl: cfg.apiUrl,
      apiKey: cfg.apiKey ?? '',
      templateId: cfg.templateId,
      requestTimeoutMs: 4000,
    })
    return { mode: 'remote', ok: true, label: cfg.place }
  } catch (err) {
    return { mode: 'remote', ok: false, label: cfg.place, error: pingError(err) }
  }
}

export async function cubeDiscard(dataDir: string, convId: string): Promise<void> {
  const cfg = await loadCubeConfig(dataDir)
  if (!cfg) return
  const key = sessionKey(dataDir, convId)
  const pending = live.get(key)
  live.delete(key)
  const saved = await readSessionId(dataDir, convId)
  const file = cubeSessionPath(dataDir, convId)
  await rm(file, { force: true }).catch(() => undefined)
  const sb = pending ? await pending.catch(() => null) : null
  if (sb) {
    await sb.kill().catch(() => undefined)
    return
  }
  if (!saved) return
  const { Sandbox } = await loadSdk()
  const connected = await Sandbox.connect(saved, { config: sdkConfig(cfg) }).catch(() => null)
  if (connected) await connected.kill().catch(() => undefined)
}

/** 到期后控制面把沙箱暂停。缓存的连接还指着停掉的数据面，404 时丢掉再 connect，由控制面恢复。 */
function sandboxPaused(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('{"error":"not found"}')
}

async function callSandbox<T>(
  dataDir: string,
  convId: string,
  cfg: CubeProviderConfig,
  fn: (sb: CubeSandbox) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await session(dataDir, convId, cfg))
  } catch (err) {
    if (!sandboxPaused(err)) throw err
    live.delete(sessionKey(dataDir, convId))
    return await fn(await session(dataDir, convId, cfg))
  }
}

async function session(dataDir: string, convId: string, cfg: CubeProviderConfig): Promise<CubeSandbox> {
  const key = sessionKey(dataDir, convId)
  const existing = live.get(key)
  if (existing) return existing
  const opening = openSession(dataDir, convId, cfg)
  live.set(key, opening)
  try {
    return await opening
  } catch (err) {
    live.delete(key)
    throw err
  }
}

async function openSession(dataDir: string, convId: string, cfg: CubeProviderConfig): Promise<CubeSandbox> {
  const { Sandbox } = await loadSdk()
  const config = sdkConfig(cfg)
  const saved = await readSessionId(dataDir, convId)
  if (saved) {
    try {
      return await Sandbox.connect(saved, { config })
    } catch {
      await rm(cubeSessionPath(dataDir, convId), { force: true }).catch(() => undefined)
    }
  }
  const created = await Sandbox.create({
    template: cfg.templateId,
    timeout: cfg.timeout ?? SESSION_TIMEOUT_S,
    lifecycle: { onTimeout: 'pause', autoResume: true },
    config,
  })
  await mkdir(path.dirname(cubeSessionPath(dataDir, convId)), { recursive: true })
  await writeFile(
    cubeSessionPath(dataDir, convId),
    `${JSON.stringify({ sandboxId: created.sandboxId })}\n`,
    'utf8',
  )
  return created
}

async function loadSdk(): Promise<CubeSdk> {
  return import('@cubesandbox/sdk') as Promise<CubeSdk>
}

function sdkConfig(cfg: CubeProviderConfig): Record<string, unknown> {
  return {
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey ?? '',
    templateId: cfg.templateId,
    proxyNodeIp: cfg.proxyNodeIp,
    proxyPort: cfg.proxyPort,
    proxyScheme: cfg.proxyScheme,
    sandboxDomain: cfg.sandboxDomain,
    timeout: cfg.timeout ?? SESSION_TIMEOUT_S,
  }
}

async function requiredConfig(dataDir: string): Promise<CubeProviderConfig> {
  const cfg = await loadCubeConfig(dataDir)
  if (!cfg) throw new Error('未启用 CubeSandbox（缺少 providers/cube.json）')
  return cfg
}

async function readSessionId(dataDir: string, convId: string): Promise<string | null> {
  try {
    const raw = await readFile(cubeSessionPath(dataDir, convId), 'utf8')
    const id = JSON.parse(raw).sandboxId
    return typeof id === 'string' && id.trim() ? id.trim() : null
  } catch {
    return null
  }
}

async function readText(sb: CubeSandbox, file: string): Promise<string> {
  const text = await sb.files.read(file, { format: 'text' })
  return typeof text === 'string' ? text : Buffer.from(text).toString('utf8')
}

async function readBytes(sb: CubeSandbox, file: string): Promise<Uint8Array> {
  const data = await sb.files.read(file, { format: 'bytes' })
  return typeof data === 'string' ? Buffer.from(data) : data
}

async function writeText(sb: CubeSandbox, file: string, content: string): Promise<void> {
  const dir = file.slice(0, file.lastIndexOf('/')) || '/'
  if (dir !== '/') {
    const made = await sb.commands.run(`mkdir -p ${shq(dir)}`, { timeoutMs: 15_000 })
    if ((made.exitCode ?? 1) !== 0) {
      throw new Error((made.stderr || made.stdout || '无法创建目录').trim())
    }
  }
  await sb.files.write(file, content)
}

async function fileSize(sb: CubeSandbox, file: string): Promise<number | null> {
  try {
    const entry = await sb.files.stat(file)
    const n = Number(entry.size ?? entry.fileSize)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

function pingError(err: unknown): string {
  const cause = err instanceof Error ? (err as Error & { cause?: { code?: string } }).cause : undefined
  const code = cause?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return '连不上'
  }
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || (err instanceof Error && err.name === 'TimeoutError')) {
    return '连接超时'
  }
  const message = err instanceof Error ? err.message : String(err)
  const line = message.split('\n')[0]?.trim() || '连接失败'
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

function sessionKey(dataDir: string, convId: string): string {
  return `${dataDir}\0${convId}`
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function positiveInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) throw new Error('offset/limit must be a positive integer')
  return n
}

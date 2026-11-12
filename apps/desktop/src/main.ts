const { app, BrowserWindow, dialog, ipcMain, nativeImage, session, shell } = require('electron')
const { spawn, execFile } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const { appendFile, cp, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { mkdir, rename, writeFile: fsWriteFile } = require('node:fs/promises')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)
const {
  pickDeepSeekKeyFromSettings,
  resolveWebContentProvider,
} = require('./web-content/resolve')

/**
 * Electron 在 IPC handler reject 时会 console.error → 写 stderr。
 * 经 concurrently / 断管启动时 stderr 常已 EPIPE，未监听的 stream error 会变成 Uncaught Exception。
 * 吞掉管道断开即可；其它错误仍抛出。
 */
function isBrokenPipe(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'EIO'
}
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (isBrokenPipe(err)) return
    throw err
  })
}
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (isBrokenPipe(err)) return
  try {
    console.error('[yagent] uncaughtException', err)
  } catch {
    /* stderr 也可能已断 */
  }
})
process.on('unhandledRejection', (reason: unknown) => {
  if (isBrokenPipe(reason)) return
  try {
    console.error('[yagent] unhandledRejection', reason)
  } catch {
    /* ignore */
  }
})

// --dev：数据目录放到项目根目录（apps/desktop 的上两级），方便测试后随手删掉
const devMode = process.argv.includes('--dev')
function dataDir(): string {
  return devMode
    ? path.join(app.getAppPath(), '..', '..', '.yagent')
    : path.join(os.homedir(), '.yagent')
}

function defaultSettingsPath(): string {
  return path.join(dataDir(), 'settings.json')
}

/* ---------- Skills：<dataDir>/skills/<id>/SKILL.md（渐进披露） ---------- */

function skillsRoot(): string {
  return path.join(dataDir(), 'skills')
}

/** 其他 Agent 常见 skills 目录（Cursor / Claude / Codex / Agents） */
function knownExternalSkillSources(): { id: string; label: string; root: string }[] {
  const home = os.homedir()
  return [
    { id: 'cursor', label: 'Cursor', root: path.join(home, '.cursor', 'skills-cursor') },
    { id: 'cursor-user', label: 'Cursor 用户', root: path.join(home, '.cursor', 'skills') },
    { id: 'claude', label: 'Claude', root: path.join(home, '.claude', 'skills') },
    { id: 'codex', label: 'Codex', root: path.join(home, '.codex', 'skills') },
    { id: 'agents', label: 'Agents', root: path.join(home, '.agents', 'skills') },
  ]
}

async function listSkillSummariesInRoot(
  root: string,
): Promise<{ id: string; name: string; description: string; path: string; disableModelInvocation: boolean }[]> {
  let entries: any[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err: any) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const out: {
    id: string
    name: string
    description: string
    path: string
    disableModelInvocation: boolean
  }[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const dir = path.join(root, entry.name)
    let isDir = entry.isDirectory()
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = (await stat(dir)).isDirectory()
      } catch {
        continue
      }
    }
    if (!isDir) continue
    const mdPath = path.join(dir, 'SKILL.md')
    try {
      const raw = await readFile(mdPath, 'utf8')
      const { name, description, disableModelInvocation } = parseSkillMd(raw)
      out.push({
        id: entry.name,
        name: name || entry.name,
        description: description || '',
        path: dir,
        disableModelInvocation,
      })
    } catch {
      // 无 SKILL.md 的目录跳过
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

function skillSlug(name: string): string {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'skill'
}

function parseSkillMd(raw: string): {
  name?: string
  description?: string
  disableModelInvocation: boolean
  body: string
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return { disableModelInvocation: false, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    meta[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  const flag = (meta['disable-model-invocation'] ?? meta.disableModelInvocation ?? '')
    .trim()
    .toLowerCase()
  return {
    name: meta.name,
    description: meta.description,
    disableModelInvocation: flag === 'true' || flag === 'yes' || flag === '1',
    body: m[2],
  }
}

function skillDirSafe(id: string): string {
  if (typeof id !== 'string' || !id.trim()) throw new Error('id required')
  if (id.includes('..') || id.includes('/') || id.includes('\\')) throw new Error('Invalid skill id')
  return path.join(skillsRoot(), id.trim())
}

function resolveSkillFile(skillDir: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!cleaned || cleaned.includes('..')) throw new Error('Invalid skill file path')
  const full = path.resolve(skillDir, cleaned)
  const root = path.resolve(skillDir)
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Skill file escapes skill directory')
  }
  return full
}

async function listSkillFiles(dir: string, prefix = '', depth = 0): Promise<string[]> {
  if (depth > 3) return []
  let entries: any[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...(await listSkillFiles(path.join(dir, entry.name), rel, depth + 1)))
    } else {
      out.push(rel)
    }
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** L2：SKILL.md 正文；L3：同目录相对文件 */
async function loadSkillContent(id: string, file?: string): Promise<string> {
  const dir = skillDirSafe(id)
  const info = await stat(dir)
  if (!info.isDirectory()) throw new Error(`Skill not found: ${id}`)
  if (file && file.trim()) {
    const target = resolveSkillFile(dir, file.trim())
    const st = await stat(target)
    if (!st.isFile()) throw new Error(`Not a file: ${file}`)
    if (st.size > 256 * 1024) throw new Error('Skill file exceeds 256KB')
    const buf = await readFile(target)
    if (buf.includes(0)) throw new Error('Binary skill file not supported')
    return (
      `--- skill: ${id.trim()} file: ${file.trim()} ---\n` +
      `path: ${target}\n\n` +
      buf.toString('utf8')
    )
  }
  const mdPath = path.join(dir, 'SKILL.md')
  const raw = await readFile(mdPath, 'utf8')
  if (raw.length > 512 * 1024) throw new Error('SKILL.md exceeds 512KB')
  const parsed = parseSkillMd(raw)
  const files = await listSkillFiles(dir)
  const bundled = files.filter((f) => f !== 'SKILL.md')
  return (
    `--- skill: ${id.trim()} ---\n` +
    `name: ${parsed.name || id.trim()}\n` +
    `description: ${parsed.description || ''}\n` +
    `dir: ${dir}\n` +
    `files: ${bundled.length ? bundled.join(', ') : '(none)'}\n\n` +
    parsed.body.trim() +
    (bundled.length
      ? `\n\n---\nTo load a bundled file, call load_skill again with file set to one of: ${bundled.join(', ')}`
      : '')
  )
}

const devServerUrl = process.env.VITE_DEV_SERVER_URL

/** 未打包时也能找到 build/ 下的图标；Dock 用 PNG（Electron 对部分 icns 会 createFromPath 空图） */
function appIconPath(): string | undefined {
  const names = ['icon.png', 'icon.icns']
  const dirs = [
    path.join(__dirname, '../build'),
    path.join(app.getAppPath(), 'build'),
    path.join(process.resourcesPath, 'build'),
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return undefined
}

/** macOS：BrowserWindow.icon 不改 Dock，需 dock.setIcon；Win/Linux 靠窗口 icon */
function applyAppIcon(): void {
  const file = appIconPath()
  if (!file) {
    if (devMode) console.warn('[yagent] 未找到 build/icon.png，Dock/窗口仍为默认 Electron 图标')
    return
  }
  let image = nativeImage.createFromPath(file)
  // 部分环境 icns 会得到空图，回退 png
  if (image.isEmpty() && file.endsWith('.icns')) {
    const png = file.replace(/\.icns$/, '.png')
    if (existsSync(png)) {
      image = nativeImage.createFromPath(png)
      if (devMode) console.warn('[yagent] icns 无效，改用', png)
    }
  }
  if (image.isEmpty()) {
    if (devMode) console.warn('[yagent] 图标加载失败:', file)
    return
  }
  // Dock：保留透明通道的 PNG；缩到 128 更贴近系统图标观感
  if (process.platform === 'darwin' && app.dock) {
    const { width } = image.getSize()
    const dockImage =
      width > 128 ? image.resize({ width: 128, height: 128, quality: 'best' }) : image
    if (typeof app.dock.setIcon === 'function') app.dock.setIcon(dockImage)
    else app.dock.setImage(dockImage)
  }
  if (devMode) console.log('[yagent] 应用图标:', file, image.getSize())
}

/**
 * 右栏内嵌浏览器：去掉 X-Frame-Options / CSP frame-ancestors，
 * 否则 PyPI 等站点会 ERR_BLOCKED_BY_RESPONSE 导致白屏。
 */
function allowEmbeddedBrowsing(): void {
  session.defaultSession.webRequest.onHeadersReceived((details: any, callback: any) => {
    const headers = { ...(details.responseHeaders ?? {}) }
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'x-frame-options') {
        delete headers[key]
        continue
      }
      if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
        const raw = headers[key]
        const list = Array.isArray(raw) ? raw : [raw]
        headers[key] = list
          .map((v: string) =>
            String(v)
              .replace(/;\s*frame-ancestors[^;]*/gi, '')
              .replace(/frame-ancestors[^;]*;?/gi, '')
              .replace(/^\s*;\s*|\s*;\s*$/g, '')
              .trim(),
          )
          .filter(Boolean)
        if (!headers[key].length) delete headers[key]
      }
    }
    callback({ responseHeaders: headers })
  })
}

function createWindow(): void {
  const icon = appIconPath()
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'yagent',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 27 },
    ...(icon ? { icon } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadFile(path.join(__dirname, '../web-dist/index.html'))
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function optionalPositiveInt(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = input[key]
  if (value === undefined || value === null || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`${key} must be a positive integer`)
  }
  return n
}

/** 按行分页读文本；默认 offset=1、limit=2000，单页最多约 80KB 字符 */
const READ_DEFAULT_LIMIT = 2000
const READ_PAGE_CHARS = 80_000

async function readFilePaged(file: string, offset: number, limit: number): Promise<string> {
  const text = await readFile(file, 'utf8')
  if (text.includes('\0')) throw new Error('Binary file is not supported by read_file')
  const lines = text.split(/\r?\n/)
  const total = lines.length
  if (offset > total) {
    return `File has ${total} lines; offset=${offset} is past the end.`
  }
  const start = offset - 1
  const out: string[] = []
  let chars = 0
  let end = start
  while (end < total && out.length < limit) {
    const formatted = `L${end + 1}: ${lines[end]}`
    if (out.length > 0 && chars + formatted.length + 1 > READ_PAGE_CHARS) break
    out.push(formatted)
    chars += formatted.length + 1
    end += 1
  }
  const last = end // 1-based last included (= exclusive 0-based end)
  const more = end < total
  const head = more
    ? `[PARTIAL] ${file}: lines ${offset}-${last} of ${total}. Next: offset=${last + 1} limit=${limit}`
    : `[OK] ${file}: lines ${offset}-${last} of ${total}`
  return `${head}\n${out.join('\n')}`
}

async function resolveInside(root: string, relativePath: string, allowMissing = false): Promise<string> {
  const base = await realpath(root)
  const target = path.resolve(base, relativePath)
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('Path is outside the bound working directory')
  let actual: string
  try {
    actual = await realpath(target)
  } catch (error: any) {
    if (!allowMissing || error.code !== 'ENOENT') throw error
    actual = target
  }
  if (actual !== base && !actual.startsWith(`${base}${path.sep}`)) throw new Error('Path is outside the bound working directory')
  return actual
}

/** 与 conversationKey / slugifyWorkdir 对齐：/Users/gyl/yagent → Users-gyl-yagent */
function slugifyWorkdir(workdir: string): string {
  const s = workdir
    .replace(/^[a-zA-Z]:/, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'root'
}

/** 会话附件目录：projects/<slug>/uploads/<convId> 或 chats/uploads/<convId> */
function uploadsDirFor(convId: string, workdir?: string | null): string {
  const wd = typeof workdir === 'string' ? workdir.trim() : ''
  return wd
    ? path.join(dataDir(), 'projects', slugifyWorkdir(wd), 'uploads', convId)
    : path.join(dataDir(), 'chats', 'uploads', convId)
}

/**
 * 纯 chat 进程隔离沙箱根目录（本机 mock；后续可换成 docker/remote）。
 * <dataDir>/sandboxes/local-process/<convId>/
 */
function localProcessSandboxDir(convId: string): string {
  return path.join(dataDir(), 'sandboxes', 'local-process', convId)
}

async function ensureLocalProcessSandbox(convId: string): Promise<{
  backend: 'local-process'
  root: string
}> {
  const id = String(convId ?? '').trim()
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('Invalid convId')
  }
  const root = localProcessSandboxDir(id)
  await mkdir(root, { recursive: true })
  return { backend: 'local-process', root }
}

/** 是否落在应用附件目录：projects/<slug>/uploads 或 chats/uploads */
function isUnderUploads(absPath: string): boolean {
  const root = path.resolve(dataDir())
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false
  const parts = rel.split(path.sep)
  if (parts[0] === 'projects' && parts[2] === 'uploads') return true
  if (parts[0] === 'chats' && parts[1] === 'uploads') return true
  return false
}

/** 是否落在本机进程沙箱：sandboxes/local-process/<convId>/… */
function isUnderLocalSandbox(absPath: string): boolean {
  const root = path.resolve(dataDir())
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false
  const parts = rel.split(path.sep)
  return parts[0] === 'sandboxes' && parts[1] === 'local-process' && parts.length >= 3
}

/** read_file / fs:read：工作区内相对路径，或 uploads / 会话沙箱下的绝对路径 */
async function resolveReadable(workdir: string, inputPath: string): Promise<string> {
  const raw = inputPath.trim()
  if (!raw) throw new Error('path is empty')
  if (path.isAbsolute(raw)) {
    let actual: string
    try {
      actual = await realpath(raw)
    } catch (error: any) {
      if (error.code === 'ENOENT') throw new Error(`File not found: ${raw}`)
      throw error
    }
    if (isUnderUploads(actual) || isUnderLocalSandbox(actual)) return actual
    // 也允许绝对路径落在工作区内
    if (workdir.trim()) {
      const base = await realpath(workdir.trim())
      if (actual === base || actual.startsWith(`${base}${path.sep}`)) return actual
    }
    throw new Error('Absolute path must be under the bound working directory, app uploads/, or chat sandbox')
  }
  if (!workdir.trim()) throw new Error('Bind a working directory before using relative paths')
  return resolveInside(workdir.trim(), raw)
}

function runCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code: any) => resolve(`${stdout}${stderr ? `\n${stderr}` : ''}\n[exit ${code ?? 1}]`))
  })
}

/* ============ SSH 远程执行（workdir = ssh://host/path） ============ */

function parseSshRoot(root: string): { host: string; path: string } | null {
  if (!root.startsWith('ssh://')) return null
  const rest = root.slice('ssh://'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return { host: rest, path: '/' }
  const host = rest.slice(0, slash)
  const raw = rest.slice(slash) || '/'
  if (raw === '/~') return { host, path: '~' }
  if (raw.startsWith('/~/')) return { host, path: `~/${raw.slice(3)}` }
  return { host, path: raw }
}

/** 供远程 shell 安全内嵌的路径引用；~ / ~/ 前缀用双引号让 $HOME 展开，其余单引号 */
function shq(s: string): string {
  if (s === '~') return '"$HOME"'
  if (s.startsWith('~/')) return `"$HOME/${s.slice(2).replace(/"/g, '\\"')}"`
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** 远程 cwd + 相对路径拼接；禁止 .. 逃逸 */
function sshJoin(cwd: string, rel: string): string {
  const r = String(rel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  if (!r || r === '.') return cwd
  if (r.split('/').includes('..')) throw new Error('Path escapes working directory')
  const base = cwd === '~' ? '~' : cwd.replace(/\/$/, '')
  return `${base}/${r}`
}

/**
 * ControlMaster socket 路径必须够短：macOS sockaddr_un ≈104 字节。
 * 勿用 os.tmpdir()（/var/folders/.../T），否则 + %C 超长 → exit 255。
 */
function sshControlPath(): string {
  if (process.platform === 'win32') {
    const dir = path.join(os.tmpdir(), 'yagent-ssh')
    mkdirSync(dir, { recursive: true })
    return path.join(dir, '%C')
  }
  // /tmp/yag-<40hex> ≈ 47 字节，远低于上限
  return '/tmp/yag-%C'
}

/** 共用 ssh 参数；mux=false 时不做连接复用（socket 路径失败时的回退） */
function sshArgs(opts?: { connectTimeout?: number; mux?: boolean }): string[] {
  const t = opts?.connectTimeout ?? 8
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${t}`,
    '-o',
    'StrictHostKeyChecking=accept-new',
  ]
  if (opts?.mux !== false) {
    args.push(
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=${sshControlPath()}`,
      '-o',
      'ControlPersist=600',
    )
  }
  return args
}

/**
 * 远程列目录（跳过点文件 / node_modules）。
 * 优先 GNU find 一次拿齐类型+大小；否则回退到循环 + stat（不再 wc -c 读整文件）。
 */
async function sshListDir(host: string, dir: string): Promise<{ name: string; isDir: boolean; size: number }[]> {
  const script = [
    `cd ${shq(dir)} 2>/dev/null || { echo "ENOENT: ${dir}" >&2; exit 3; }`,
    // GNU find：单次扫目录，%s 来自 inode，不读文件内容
    `if find --version >/dev/null 2>&1; then`,
    `  find . -maxdepth 1 -mindepth 1 ! -name '.*' ! -name node_modules \\( -type d -printf 'd|%P|0\\n' -o \\( -type f -o -type l \\) -printf 'f|%P|%s\\n' \\)`,
    `  exit 0`,
    `fi`,
    // 回退：stat 取大小（GNU -c / BSD -f），避免 wc -c
    `for e in * .[!.]* ..?*; do`,
    `  [ -e "$e" ] || continue`,
    `  n="\${e#./}"`,
    `  case "$n" in .|..|.*) continue ;; esac`,
    `  [ "$n" = "node_modules" ] && continue`,
    `  if [ -d "$n" ]; then printf 'd|%s|0\\n' "$n"`,
    `  elif [ -f "$n" ] || [ -L "$n" ]; then`,
    `    sz=$(stat -c '%s' -- "$n" 2>/dev/null || stat -f '%z' -- "$n" 2>/dev/null || echo 0)`,
    `    printf 'f|%s|%s\\n' "$n" "\${sz:-0}"`,
    `  fi`,
    `done`,
  ].join('\n')
  const { out, err, code } = await sshRun(host, script)
  if (code !== 0) throw new Error(err.trim() || `远程列目录失败（exit ${code}）`)
  const rows: { name: string; isDir: boolean; size: number }[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [kind, name, sizeStr] = line.split('|')
    if (!name || (kind !== 'd' && kind !== 'f')) continue
    rows.push({ name, isDir: kind === 'd', size: Number(sizeStr) || 0 })
    if (rows.length >= 500) break
  }
  rows.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  return rows
}

/** 读写/列目录等短操作 */
const SSH_DEFAULT_TIMEOUT_MS = 60_000
/** run_command：训练、下载等可能很久；仍建议长任务后台跑 + 短轮询 */
const SSH_RUN_COMMAND_TIMEOUT_MS = 600_000

function sshRunOnce(
  host: string,
  script: string,
  stdin: string | undefined,
  args: string[],
  timeoutMs: number,
): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...args, host, script], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      const partial = `${out}${err ? `\n${err}` : ''}`.trim()
      const tip =
        `ssh 执行超时（>${Math.round(timeoutMs / 1000)}s）。` +
        `本地 SSH 已断开；若远程是 nohup/setsid 后台任务，进程多半还在——先 pgrep/tail 日志接上，不要重复启动。` +
        `若是前台长命令，远程侧通常已随会话结束，需改后台后重跑。`
      reject(new Error(partial ? `${tip}\n--- partial ---\n${partial.slice(-6000)}` : tip))
    }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      out += c
    })
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      err += c
    })
    child.once('error', (e: any) => {
      clearTimeout(timer)
      reject(e)
    })
    child.once('close', (code: any) => {
      clearTimeout(timer)
      resolve({ out, err, code: code ?? 1 })
    })
    if (stdin != null) child.stdin.write(stdin)
    child.stdin.end()
  })
}

/** 通过 ssh 在远程跑一段 shell；默认走 ControlMaster 复用，socket 过长则自动降级 */
async function sshRun(
  host: string,
  script: string,
  stdin?: string,
  opts?: { timeoutMs?: number; connectTimeout?: number },
): Promise<{ out: string; err: string; code: number }> {
  const timeoutMs = opts?.timeoutMs ?? SSH_DEFAULT_TIMEOUT_MS
  const connectTimeout = opts?.connectTimeout
  const first = await sshRunOnce(
    host,
    script,
    stdin,
    sshArgs({ connectTimeout }),
    timeoutMs,
  )
  if (
    first.code !== 0 &&
    /too long for Unix domain socket|cannot bind to path/i.test(first.err)
  ) {
    return sshRunOnce(host, script, stdin, sshArgs({ connectTimeout, mux: false }), timeoutMs)
  }
  return first
}

/** 远程读文件分页（与本地 readFilePaged 输出格式一致：[OK]/[PARTIAL] + LN: 行） */
async function sshReadFilePaged(host: string, cwd: string, relPath: string, offset: number, limit: number): Promise<string> {
  const off = Math.max(1, offset)
  const lim = Math.max(1, limit)
  const script = [
    `cd ${shq(cwd)} 2>/dev/null || { echo "无法进入目录 ${cwd}" >&2; exit 3; }`,
    `f=${shq(relPath)}`,
    `[ -f "$f" ] || { echo "File not found: ${relPath}" >&2; exit 4; }`,
    `awk -v off=${off} -v lim=${lim} -v f="$f" '`,
    `{ total++ }`,
    `NR>=off && NR<off+lim { buf = buf "L" NR ": " $0 "\\n"; last=NR }`,
    `END {`,
    `  if (off > total) { printf "File has %d lines; offset=%d is past the end.", total, off; exit }`,
    `  more = (off+lim-1) < total`,
    `  if (more) printf "[PARTIAL] %s: lines %d-%d of %d. Next: offset=%d limit=%d\\n", f, off, last, total, last+1, lim`,
    `  else printf "[OK] %s: lines %d-%d of %d\\n", f, off, last, total`,
    `  printf "%s", buf`,
    `}' "$f"`,
  ].join(' && ')
  const { out, err, code } = await sshRun(host, script)
  if (code !== 0) throw new Error(err.trim() || `远程读取失败（exit ${code}）`)
  return out
}

/** 从 settings.json 解析网络内容后端（每次工具调用读盘，改设置立刻生效） */
async function resolveWebProviderFromDisk(): Promise<ReturnType<typeof resolveWebContentProvider>> {
  let provider: string | undefined
  let deepseekApiKey: string | undefined
  let deepseekBaseURL: string | undefined
  try {
    const raw = await readFile(defaultSettingsPath(), 'utf8')
    const settings = JSON.parse(raw) as {
      tools?: { webProvider?: string }
      models?: Array<{ provider?: string; apiKey?: string; baseURL?: string }>
    }
    provider = settings.tools?.webProvider
    const ds = pickDeepSeekKeyFromSettings(settings)
    if (ds) {
      deepseekApiKey = ds.apiKey
      deepseekBaseURL = ds.baseURL
    }
  } catch {
    // 无设置文件或损坏 → 走默认 bing
  }
  return resolveWebContentProvider({ provider, deepseekApiKey, deepseekBaseURL })
}

async function executeTool(_event: any, request: { name: string; input: Record<string, unknown>; workdir: string }): Promise<string> {
  // 网络工具不依赖工作目录；后端可替换（bing HTML / DeepSeek Search·Fetch）
  if (request.name === 'fetch_url' || request.name === 'search_web') {
    const web = await resolveWebProviderFromDisk()
    if (request.name === 'fetch_url') {
      return web.fetch(requiredString(request.input, 'url'))
    }
    return web.search(requiredString(request.input, 'query'))
  }

  const root = request.workdir.trim()
  // 远程（SSH）工作目录：读写/命令通过 ssh 在远程主机执行
  const ssh = parseSshRoot(root)
  if (ssh) {
    switch (request.name) {
      case 'read_file': {
        const file = requiredString(request.input, 'path')
        const offset = optionalPositiveInt(request.input, 'offset', 1)
        const limit = optionalPositiveInt(request.input, 'limit', READ_DEFAULT_LIMIT)
        return sshReadFilePaged(ssh.host, ssh.path, file, offset, limit)
      }
      case 'write_file': {
        const file = requiredString(request.input, 'path')
        const content = requiredString(request.input, 'content')
        const script = `cd ${shq(ssh.path)} && mkdir -p "$(dirname ${shq(file)})" && cat > ${shq(file)}`
        const w = await sshRun(ssh.host, script, content)
        if (w.code !== 0) throw new Error(w.err.trim() || `远程写入失败（exit ${w.code}）`)
        return `Wrote ${file} (ssh: ${ssh.host})`
      }
      case 'run_command': {
        const command = requiredString(request.input, 'command')
        try {
          const r = await sshRun(ssh.host, `cd ${shq(ssh.path)} && ${command}`, undefined, {
            timeoutMs: SSH_RUN_COMMAND_TIMEOUT_MS,
          })
          return `${r.out}${r.err ? `\n${r.err}` : ''}\n[exit ${r.code}] (ssh: ${ssh.host})`
        } catch (e: any) {
          const msg = String(e?.message ?? e)
          // 超时不抛死：把已有输出 + 接续步骤交回 agent，方便挽救
          if (/ssh 执行超时/.test(msg)) {
            return (
              `${msg}\n[exit timeout] (ssh: ${ssh.host})\n` +
              `接续步骤：pgrep -af 相关进程；tail -n 50 日志；确认仍在跑则只轮询，确认已结束后再读结果。`
            )
          }
          throw e
        }
      }
      case 'load_skill': {
        const id = requiredString(request.input, 'id')
        const file =
          typeof request.input.file === 'string' && request.input.file.trim()
            ? request.input.file.trim()
            : undefined
        return loadSkillContent(id, file)
      }
      default:
        throw new Error(`Unknown tool: ${request.name}`)
    }
  }
  // read_file 可在无 workdir 时读 uploads 绝对路径；写/命令仍要求绑定目录
  if (request.name === 'read_file') {
    const file = await resolveReadable(root, requiredString(request.input, 'path'))
    const offset = optionalPositiveInt(request.input, 'offset', 1)
    const limit = optionalPositiveInt(request.input, 'limit', READ_DEFAULT_LIMIT)
    return readFilePaged(file, offset, limit)
  }
  // skills 目录在 dataDir，不依赖会话 workdir
  if (request.name === 'load_skill') {
    const id = requiredString(request.input, 'id')
    const file =
      typeof request.input.file === 'string' && request.input.file.trim()
        ? request.input.file.trim()
        : undefined
    return loadSkillContent(id, file)
  }
  if (!root) throw new Error('Bind a working directory before using local tools')
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('Bound working directory is not a directory')
  // 审批在渲染层做（输入框上方的横条），这里只管执行；写/命令仍限制在绑定目录内
  switch (request.name) {
    case 'write_file': {
      const filePath = requiredString(request.input, 'path')
      const content = requiredString(request.input, 'content')
      const file = await resolveInside(root, filePath, true)
      await writeFile(file, content, 'utf8')
      return `Wrote ${path.relative(root, file)}`
    }
    case 'run_command': {
      const command = requiredString(request.input, 'command')
      return runCommand(command, root)
    }
    default:
      throw new Error(`Unknown tool: ${request.name}`)
  }
}

void app.whenReady().then(async () => {
  allowEmbeddedBrowsing()
  if (devMode) console.log(`[yagent] dev 模式：数据目录 = ${dataDir()}`)
  applyAppIcon()
  // 语音输入暂关：不再启动时要麦克风权限
  // if (process.platform === 'darwin') {
  //   try {
  //     const { systemPreferences } = require('electron')
  //     const ok = await systemPreferences.askForMediaAccess('microphone')
  //     if (devMode) console.log(`[yagent] 麦克风权限: ${ok ? '已授权' : '未授权'}`)
  //   } catch (err) {
  //     if (devMode) console.warn('[yagent] 麦克风权限请求失败', err)
  //   }
  // }
  // 设置存储
  const settingsFilePath = defaultSettingsPath()

  const readSettings = async (): Promise<string | null> => {
    try {
      return await readFile(settingsFilePath, 'utf8')
    } catch (err: any) {
      if (err.code === 'ENOENT') return null
      throw err
    }
  }

  const atomicWrite = async (filePath: string, content: string): Promise<void> => {
    await mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`
    await fsWriteFile(tmp, content, 'utf8')
    await rename(tmp, filePath)
  }

  const writeSettings = async (content: string): Promise<void> => {
    await atomicWrite(settingsFilePath, content)
  }

  // 会话存储：直接放数据目录下，按 key 组织（不再有 conversations/ 中间层）：
  //   <dataDir>/projects/<目录slug>/<convId>.jsonl（绑定目录的任务）  <dataDir>/chats/<convId>.jsonl（纯对话）
  const convsDir = (): string => dataDir()
  const convPath = (key: string): string => {
    if (path.isAbsolute(key) || key.split('/').includes('..')) throw new Error('Invalid conversation key')
    return path.join(convsDir(), key)
  }

  ipcMain.handle('settings:read', readSettings)
  ipcMain.handle('settings:write', (_e: any, content: string) => writeSettings(content))

  const usageFilePath = () => path.join(dataDir(), 'token-usage.json')
  ipcMain.handle('usage:read', async () => {
    try {
      return await readFile(usageFilePath(), 'utf8')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  })
  ipcMain.handle('usage:write', async (_e: any, content: string) => {
    await mkdir(dataDir(), { recursive: true })
    await writeFile(usageFilePath(), content, 'utf8')
  })

  // 收获：<dataDir>/insights/<id>.json；收藏副本 → insights/sight/<id>.json
  const insightsDir = () => path.join(dataDir(), 'insights')
  const sightDir = () => path.join(insightsDir(), 'sight')
  const assertInsightId = (id: string) => {
    if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new Error('Invalid insight id')
    }
  }
  const insightPath = (id: string) => {
    assertInsightId(id)
    return path.join(insightsDir(), `${id}.json`)
  }
  const sightPath = (id: string) => {
    assertInsightId(id)
    return path.join(sightDir(), `${id}.json`)
  }
  const syncSightCopy = async (insight: { id: string; mark?: string }) => {
    if (insight.mark === 'keep') {
      await mkdir(sightDir(), { recursive: true })
      await writeFile(sightPath(insight.id), JSON.stringify(insight, null, 2) + '\n', 'utf8')
    } else {
      try {
        await rm(sightPath(insight.id), { force: true })
      } catch {
        //
      }
    }
  }
  ipcMain.handle('insights:write', async (_e: any, insight: any) => {
    if (!insight || typeof insight.id !== 'string') throw new Error('insight.id required')
    await mkdir(insightsDir(), { recursive: true })
    await writeFile(insightPath(insight.id), JSON.stringify(insight, null, 2) + '\n', 'utf8')
    await syncSightCopy(insight)
  })
  ipcMain.handle('insights:read', async (_e: any, id: string) => {
    try {
      return JSON.parse(await readFile(insightPath(id), 'utf8'))
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  })
  ipcMain.handle('insights:readMany', async (_e: any, ids: string[]) => {
    const list = Array.isArray(ids) ? ids : []
    const out: any[] = []
    for (const id of list) {
      if (typeof id !== 'string' || !id) continue
      try {
        out.push(JSON.parse(await readFile(insightPath(id), 'utf8')))
      } catch {
        // 缺文件跳过
      }
    }
    return out
  })
  ipcMain.handle('insights:listSight', async () => {
    try {
      const names = await readdir(sightDir())
      const out: any[] = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        try {
          out.push(JSON.parse(await readFile(path.join(sightDir(), name), 'utf8')))
        } catch {
          //
        }
      }
      out.sort((a, b) => (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0))
      return out
    } catch (err: any) {
      if (err?.code === 'ENOENT') return []
      throw err
    }
  })
  ipcMain.handle('insights:delete', async (_e: any, id: string, opts?: { preserveSight?: boolean }) => {
    try {
      await rm(insightPath(id), { force: true })
    } catch {
      //
    }
    if (!opts?.preserveSight) {
      try {
        await rm(sightPath(id), { force: true })
      } catch {
        //
      }
    }
  })
  ipcMain.handle('insights:deleteMany', async (_e: any, ids: string[], opts?: { preserveSight?: boolean }) => {
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || !id) continue
      try {
        await rm(insightPath(id), { force: true })
      } catch {
        //
      }
      if (!opts?.preserveSight) {
        try {
          await rm(sightPath(id), { force: true })
        } catch {
          //
        }
      }
    }
  })

  ipcMain.handle('conversations:list', async () => {
    // 递归扫描 chats/ 与 projects/（settings.json 等非会话文件排除在外）
    const out: { key: string; text: string }[] = []
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries: any[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (err: any) {
        if (err.code === 'ENOENT') return
        throw err
      }
      for (const entry of entries) {
        const r = rel ? `${rel}/${entry.name}` : entry.name
        // 只进 chats/ 和 projects/ 子树
        const inScope = rel !== '' || entry.name === 'chats' || entry.name === 'projects'
        if (entry.isDirectory() && inScope) await walk(path.join(dir, entry.name), r)
        else if (
          entry.isFile() &&
          (r.endsWith('.jsonl') ||
            (r.endsWith('.json') &&
              entry.name !== 'settings.json' &&
              entry.name !== 'project.json' &&
              !r.includes('.tmp')))
        ) {
          out.push({ key: r, text: await readFile(path.join(dir, entry.name), 'utf8') })
        }
      }
    }
    await walk(convsDir(), '')
    return out
  })
  ipcMain.handle('conversations:write', (_e: any, key: string, content: string) =>
    atomicWrite(convPath(key), content),
  )
  ipcMain.handle('conversations:append', async (_e: any, key: string, lines: string) => {
    const file = convPath(key)
    await mkdir(path.dirname(file), { recursive: true })
    await appendFile(file, lines, 'utf8')
  })
  ipcMain.handle('conversations:delete', async (_e: any, key: string) => {
    try {
      await rm(convPath(key))
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  })
  // 项目登记：projects/<slug>/project.json —— 删光会话后仍保留空项目，方便再建任务
  const projectMetaPath = (workdir: string): string =>
    path.join(dataDir(), 'projects', slugifyWorkdir(workdir), 'project.json')
  ipcMain.handle('projects:list', async () => {
    const root = path.join(dataDir(), 'projects')
    let entries: any[]
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (err: any) {
      if (err.code === 'ENOENT') return [] as string[]
      throw err
    }
    const out: { workdir: string; updatedAt: number }[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const raw = await readFile(path.join(root, entry.name, 'project.json'), 'utf8')
        const meta = JSON.parse(raw) as { workdir?: string; updatedAt?: number }
        if (typeof meta.workdir === 'string' && meta.workdir.trim()) {
          out.push({ workdir: meta.workdir.trim(), updatedAt: meta.updatedAt ?? 0 })
        }
      } catch {
        // 无 meta 的旧目录忽略；有会话时侧栏仍能从 conv.workdir 推出
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt)
    return out.map((x) => x.workdir)
  })
  ipcMain.handle('projects:remember', async (_e: any, workdir: string) => {
    const wd = typeof workdir === 'string' ? workdir.trim() : ''
    if (!wd) throw new Error('workdir required')
    await atomicWrite(
      projectMetaPath(wd),
      `${JSON.stringify({ workdir: wd, updatedAt: Date.now() }, null, 2)}\n`,
    )
  })
  ipcMain.handle('projects:forget', async (_e: any, workdir: string) => {
    const wd = typeof workdir === 'string' ? workdir.trim() : ''
    if (!wd) throw new Error('workdir required')
    try {
      await rm(projectMetaPath(wd))
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  })
  ipcMain.handle('tools:execute', executeTool)
  // 只读文件浏览（右栏文件页）：列目录 / 读文件，路径限制在绑定目录内，隐藏点开头文件（.env 等）
  ipcMain.handle('fs:list', async (_e: any, workdir: string, rel: string) => {
    const ssh = parseSshRoot(String(workdir ?? '').trim())
    if (ssh) {
      return sshListDir(ssh.host, sshJoin(ssh.path, rel || '.'))
    }
    const dir = await resolveInside(workdir, rel || '.')
    const entries = await readdir(dir, { withFileTypes: true })
    const out: { name: string; isDir: boolean; size: number }[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue
      let size = 0
      if (entry.isFile()) {
        size = (await stat(path.join(dir, entry.name))).size
      }
      out.push({ name: entry.name, isDir: entry.isDirectory(), size })
      if (out.length >= 500) break
    }
    out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    return out
  })
  // 返回结构化预览；不可预览（过大 / 二进制）用 unavailable，避免 IPC throw 把 UI 打成异常态
  ipcMain.handle('fs:read', async (_e: any, workdir: string, rel: string) => {
    const sshRoot = parseSshRoot(String(workdir ?? '').trim())
    if (sshRoot) {
      const remote = sshJoin(sshRoot.path, rel)
      const ext = path.extname(remote).toLowerCase()
      const unavailable = (reason: string, size = 0) => ({ kind: 'unavailable' as const, reason, size })
      const binaryExt = new Set([
        '.pth', '.pt', '.ckpt', '.safetensors', '.bin', '.pkl', '.pickle', '.npy', '.npz',
        '.onnx', '.h5', '.pb', '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.exe', '.dll',
        '.so', '.dylib', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg',
        '.m4a', '.flac', '.mp4', '.mov', '.webm', '.mkv', '.avi',
      ])
      if (binaryExt.has(ext)) {
        // 仅取大小，一次往返
        const meta = await sshRun(
          sshRoot.host,
          `[ -f ${shq(remote)} ] || { echo NOTFILE >&2; exit 4; }; stat -c '%s' -- ${shq(remote)} 2>/dev/null || stat -f '%z' -- ${shq(remote)}`,
        )
        if (meta.code !== 0) {
          const msg = meta.err.trim()
          if (msg.includes('NOTFILE') || msg.includes('No such')) throw new Error('Not a file')
          throw new Error(msg || `远程读取失败（exit ${meta.code}）`)
        }
        return unavailable('二进制文件不支持预览', Number(meta.out.trim()) || 0)
      }
      const imageMime: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
      }
      const mime = imageMime[ext]
      const moleculeExt = new Set(['.xyz', '.pdb', '.sdf', '.mol', '.mol2', '.cif', '.gro', '.pqr'])
      const textLimit =
        ext === '.html' || ext === '.htm' || ext === '.md' || ext === '.markdown'
          ? 512 * 1024
          : moleculeExt.has(ext)
            ? 2 * 1024 * 1024
            : 256 * 1024
      const byteLimit = mime ? 5 * 1024 * 1024 : ext === '.pdf' ? 10 * 1024 * 1024 : textLimit
      // 一次 SSH：stat 大小 → 过大只回 SIZE；否则 SIZE\\n + 正文/base64
      const mode = mime || ext === '.pdf' ? 'b64' : 'text'
      const script = [
        `f=${shq(remote)}`,
        `[ -f "$f" ] || { echo NOTFILE >&2; exit 4; }`,
        `sz=$(stat -c '%s' -- "$f" 2>/dev/null || stat -f '%z' -- "$f" 2>/dev/null || echo 0)`,
        `sz=\${sz:-0}`,
        `if [ "$sz" -gt ${byteLimit} ]; then printf 'BIG|%s\\n' "$sz"; exit 0; fi`,
        `printf 'OK|%s\\n' "$sz"`,
        mode === 'b64'
          ? `base64 < "$f" | tr -d '\\n'; echo`
          : `LC_ALL=C cat "$f"`,
      ].join('\n')
      const body = await sshRun(sshRoot.host, script)
      if (body.code !== 0) {
        const msg = body.err.trim()
        if (msg.includes('NOTFILE') || msg.includes('No such')) throw new Error('Not a file')
        return unavailable(msg || `远程读取失败（exit ${body.code}）`)
      }
      const nl = body.out.indexOf('\n')
      const head = nl >= 0 ? body.out.slice(0, nl) : body.out
      const payload = nl >= 0 ? body.out.slice(nl + 1) : ''
      const [tag, sizeStr] = head.split('|')
      const size = Number(sizeStr) || 0
      if (tag === 'BIG') {
        return unavailable(
          mime
            ? '图片超过 5MB，请在编辑器中打开'
            : ext === '.pdf'
              ? 'PDF 超过 10MB，请在编辑器中打开'
              : '文件过大，请在编辑器中打开',
          size,
        )
      }
      if (tag !== 'OK') return unavailable(body.err.trim() || '远程读取失败', size)
      if (mime) {
        return {
          kind: 'image' as const,
          mime,
          dataUrl: `data:${mime};base64,${payload.replace(/\s+/g, '')}`,
        }
      }
      if (ext === '.pdf') {
        return {
          kind: 'pdf' as const,
          dataUrl: `data:application/pdf;base64,${payload.replace(/\s+/g, '')}`,
        }
      }
      if (payload.includes('\0')) return unavailable('二进制文件不支持预览', size)
      if (ext === '.html' || ext === '.htm') return { kind: 'html' as const, content: payload }
      if (ext === '.md' || ext === '.markdown') return { kind: 'markdown' as const, content: payload }
      if (moleculeExt.has(ext)) {
        return { kind: 'molecule' as const, format: ext.slice(1), content: payload }
      }
      return { kind: 'text' as const, content: payload }
    }
    // 允许工作区内相对路径，或 uploads / 沙箱下的绝对路径（纯 chat 附件预览）
    const file = await resolveReadable(String(workdir ?? ''), String(rel ?? ''))
    const info = await stat(file)
    if (!info.isFile()) throw new Error('Not a file')
    const ext = path.extname(file).toLowerCase()
    const unavailable = (reason: string) =>
      ({ kind: 'unavailable' as const, reason, size: info.size })
    const imageMime: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
    }
    // 权重 / 压缩包 / 媒体等：点开只展示元信息，不整文件读入
    const binaryExt = new Set([
      '.pth',
      '.pt',
      '.ckpt',
      '.safetensors',
      '.bin',
      '.pkl',
      '.pickle',
      '.npy',
      '.npz',
      '.onnx',
      '.h5',
      '.pb',
      '.zip',
      '.tar',
      '.gz',
      '.tgz',
      '.rar',
      '.7z',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.wasm',
      '.woff',
      '.woff2',
      '.ttf',
      '.otf',
      '.mp3',
      '.wav',
      '.ogg',
      '.m4a',
      '.flac',
      '.mp4',
      '.mov',
      '.webm',
      '.mkv',
      '.avi',
    ])
    if (binaryExt.has(ext)) return unavailable('二进制文件不支持预览')
    const mime = imageMime[ext]
    if (mime) {
      if (info.size > 5 * 1024 * 1024) return unavailable('图片超过 5MB，请在编辑器中打开')
      const buf = await readFile(file)
      return { kind: 'image' as const, mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    }
    if (ext === '.html' || ext === '.htm') {
      if (info.size > 512 * 1024) return unavailable('HTML 超过 512KB，请在编辑器中打开')
      // baseHref：预览 iframe 解析相对 CSS/图片；目录 URL 末尾带 /
      const baseHref = pathToFileURL(path.dirname(file) + path.sep).href
      return { kind: 'html' as const, content: await readFile(file, 'utf8'), baseHref }
    }
    if (ext === '.md' || ext === '.markdown') {
      if (info.size > 512 * 1024) return unavailable('Markdown 超过 512KB，请在编辑器中打开')
      return { kind: 'markdown' as const, content: await readFile(file, 'utf8') }
    }
    if (ext === '.pdf') {
      if (info.size > 10 * 1024 * 1024) return unavailable('PDF 超过 10MB，请在编辑器中打开')
      const buf = await readFile(file)
      return {
        kind: 'pdf' as const,
        dataUrl: `data:application/pdf;base64,${buf.toString('base64')}`,
      }
    }
    const moleculeExt = new Set(['.xyz', '.pdb', '.sdf', '.mol', '.mol2', '.cif', '.gro', '.pqr'])
    if (moleculeExt.has(ext)) {
      if (info.size > 2 * 1024 * 1024) return unavailable('结构文件超过 2MB，请在编辑器中打开')
      const text = await readFile(file, 'utf8')
      if (text.includes('\0')) return unavailable('二进制文件不支持预览')
      return { kind: 'molecule' as const, format: ext.slice(1), content: text }
    }
    if (info.size > 256 * 1024) return unavailable('文件超过 256KB，请在编辑器中打开')
    const buf = await readFile(file)
    if (buf.includes(0)) return unavailable('二进制文件不支持预览')
    return { kind: 'text' as const, content: buf.toString('utf8') }
  })
  /**
   * 把 workdir+rel 解析成可本地打开的绝对路径。
   * - 本地：文件或目录均可
   * - 远程文件：scp 到临时文件
   * - 远程目录：不能直接给 GUI App，抛错（终端另走 ssh）
   */
  async function resolveOpenableLocal(
    workdir: string,
    rel: string,
    opts?: { allowDir?: boolean },
  ): Promise<{ path: string; isDir: boolean }> {
    const allowDir = opts?.allowDir !== false
    const wd = String(workdir ?? '').trim()
    const r = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!wd) throw new Error('未绑定工作目录')
    // rel 为空表示项目根目录
    if (r.split('/').includes('..')) throw new Error('无效路径')
    const ssh = parseSshRoot(wd)
    if (!ssh) {
      const localPath = r ? await resolveInside(wd, r) : path.resolve(wd)
      const info = await stat(localPath)
      if (info.isDirectory()) {
        if (!allowDir) throw new Error('不是文件')
        return { path: localPath, isDir: true }
      }
      if (!info.isFile()) throw new Error('不是文件')
      return { path: localPath, isDir: false }
    }
    const remote = r ? sshJoin(ssh.path, r) : ssh.path
    const meta = await sshRun(
      ssh.host,
      `if [ -d ${shq(remote)} ]; then echo DIR; elif [ -f ${shq(remote)} ]; then echo FILE; stat -c '%s' -- ${shq(remote)} 2>/dev/null || stat -f '%z' -- ${shq(remote)}; else echo MISSING >&2; exit 4; fi`,
      undefined,
      { timeoutMs: 15000, connectTimeout: 10 },
    )
    if (meta.code !== 0) {
      const msg = meta.err.trim()
      if (msg.includes('MISSING') || /No such/i.test(msg)) throw new Error('路径不存在')
      throw new Error(msg || '无法读取远程路径')
    }
    const lines = meta.out.trim().split('\n')
    if (lines[0] === 'DIR') {
      if (!allowDir) throw new Error('不是文件')
      throw new Error('远程目录请用「在终端中打开目录」')
    }
    if (lines[0] !== 'FILE') throw new Error('不是文件')
    const size = Number(lines[1] || 0) || 0
    if (size > 80 * 1024 * 1024) throw new Error('文件过大（超过 80MB），请在远程主机打开')
    const safe = path.basename(r || 'file').replace(/[^\w.\u4e00-\u9fff()-]+/g, '_') || 'file'
    const tmp = path.join(os.tmpdir(), `yagent-open-${Date.now()}-${safe}`)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'scp',
        [...sshArgs({ connectTimeout: 20 }), '--', `${ssh.host}:${remote}`, tmp],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('下载超时'))
      }, 120_000)
      child.stderr.setEncoding('utf8').on('data', (c: string) => {
        err += c
      })
      child.once('error', (e: Error) => {
        clearTimeout(timer)
        reject(e)
      })
      child.once('close', (code: number | null) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(err.trim() || `scp 退出码 ${code}`))
      })
    })
    return { path: tmp, isDir: false }
  }

  function openHandlersBin(): string {
    // 打包后：resources/bin；dev：apps/desktop/bin
    const candidates = [
      path.join(process.resourcesPath || '', 'bin', 'list-open-handlers'),
      path.join(app.getAppPath(), 'bin', 'list-open-handlers'),
      path.join(__dirname, '..', 'bin', 'list-open-handlers'),
    ]
    for (const c of candidates) {
      if (c && existsSync(c)) return c
    }
    return ''
  }

  function macAppDisplayName(appPath: string): string {
    const info = path.join(appPath, 'Contents', 'Info.plist')
    if (!existsSync(info)) return path.basename(appPath, '.app')
    for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
      try {
        const { stdout } = require('node:child_process').execFileSync('plutil', ['-extract', key, 'raw', info], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        const n = String(stdout || '').trim()
        if (n && n !== '(null)') return n
      } catch {
        /* try next */
      }
    }
    return path.basename(appPath, '.app')
  }

  async function macSystemOpenIcons(): Promise<{ reveal?: string; terminal?: string }> {
    const systemIcons: { reveal?: string; terminal?: string } = {}
    if (process.platform !== 'darwin') return systemIcons
    const pairs: [keyof typeof systemIcons, string][] = [
      ['reveal', '/System/Library/CoreServices/Finder.app'],
      ['terminal', '/System/Applications/Utilities/Terminal.app'],
    ]
    for (const [key, p] of pairs) {
      try {
        if (!existsSync(p)) continue
        const img = await app.getFileIcon(p, { size: 'normal' })
        if (!img.isEmpty()) systemIcons[key] = img.toDataURL()
      } catch {
        /* ignore */
      }
    }
    return systemIcons
  }

  /** 打开菜单数据：可打开的应用列表 + 默认应用（macOS 用 Launch Services） */
  ipcMain.handle('fs:openMenu', async (_e: any, workdir: string, rel: string) => {
    try {
      let localPath = ''
      let folder = ''
      let probePath = ''
      try {
        const resolved = await resolveOpenableLocal(workdir, rel, { allowDir: true })
        localPath = resolved.path
        folder = resolved.isDir ? localPath : path.dirname(localPath)
        probePath = localPath
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        // 远程目录无法用 GUI App 打开：只回终端入口，不造假本地目录骗出 App 列表
        if (!/远程目录/.test(msg)) throw e
        const ssh = parseSshRoot(String(workdir ?? '').trim())
        if (!ssh) throw e
        const remoteRel = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
        folder = remoteRel ? sshJoin(ssh.path, remoteRel) : ssh.path
        const systemIcons = await macSystemOpenIcons()
        return { ok: true, localPath: '', folder, apps: [], systemIcons, remoteDir: true }
      }
      type AppItem = { id: string; name: string; path: string; isDefault: boolean; iconDataUrl?: string }
      const apps: AppItem[] = []
      if (process.platform === 'darwin') {
        const bin = openHandlersBin()
        if (bin) {
          const { stdout } = await execFileAsync(bin, [probePath], { timeout: 12000 })
          const parsed = JSON.parse(String(stdout || '{}')) as {
            default?: string | null
            apps?: { path?: string; name?: string; icon?: string }[] | string[]
            systemIcons?: { reveal?: string; terminal?: string }
          }
          const def = parsed.default || ''
          const list = Array.isArray(parsed.apps) ? parsed.apps : []
          /** 默认优先，最多 3 个应用（再加访达/终端） */
          for (const raw of list.slice(0, 3)) {
            const appPath = typeof raw === 'string' ? raw : String(raw?.path || '')
            if (!appPath || !existsSync(appPath)) continue
            const name =
              typeof raw === 'object' && raw?.name
                ? String(raw.name)
                : macAppDisplayName(appPath)
            let iconDataUrl: string | undefined
            if (typeof raw === 'object' && typeof raw?.icon === 'string' && raw.icon) {
              iconDataUrl = `data:image/png;base64,${raw.icon}`
            } else {
              try {
                const img = await app.getFileIcon(appPath, { size: 'normal' })
                if (!img.isEmpty()) iconDataUrl = img.toDataURL()
              } catch {
                /* ignore */
              }
            }
            apps.push({
              id: appPath,
              name,
              path: appPath,
              isDefault: !!def && appPath === def,
              iconDataUrl,
            })
          }
          if (def && !apps.some((a) => a.isDefault)) {
            const hit = apps.find((a) => a.path === def)
            if (hit) hit.isDefault = true
          }

          /** 访达 / 终端：与应用列表同用 Swift 压好的 PNG */
          const systemIcons: { reveal?: string; terminal?: string } = {}
          const rawSys = parsed.systemIcons || {}
          if (rawSys.reveal) systemIcons.reveal = `data:image/png;base64,${rawSys.reveal}`
          if (rawSys.terminal) systemIcons.terminal = `data:image/png;base64,${rawSys.terminal}`
          if (!apps.length) {
            apps.push({ id: '', name: '默认应用', path: '', isDefault: true })
          }
          return { ok: true, localPath, folder, apps, systemIcons }
        }
      }
      if (!apps.length) {
        apps.push({ id: '', name: '默认应用', path: '', isDefault: true })
      }

      /** 非 macOS / 无 helper：尽量用 Electron 兜底 */
      return { ok: true, localPath, folder, apps, systemIcons: await macSystemOpenIcons() }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e), apps: [] as never[], systemIcons: {} }
    }
  })

  /** 打开后延迟清掉 scp 下来的临时文件 */
  function scheduleUnlinkTemp(file: string) {
    if (!file.includes(`${path.sep}yagent-open-`)) return
    setTimeout(() => {
      void rm(file, { force: true }).catch(() => undefined)
    }, 120_000)
  }

  /** 用指定应用（macOS appPath）或系统默认打开（文件或目录） */
  ipcMain.handle(
    'fs:openWithApp',
    async (_e: any, workdir: string, rel: string, appPath?: string | null) => {
      try {
        const { path: localPath } = await resolveOpenableLocal(workdir, rel, { allowDir: true })
        const target = typeof appPath === 'string' ? appPath.trim() : ''
        if (target && process.platform === 'darwin') {
          await execFileAsync('open', ['-a', target, localPath])
          scheduleUnlinkTemp(localPath)
          return { ok: true }
        }
        if (target && process.platform === 'win32') {
          await execFileAsync('cmd', ['/c', 'start', '', target, localPath])
          scheduleUnlinkTemp(localPath)
          return { ok: true }
        }
        const openErr = await shell.openPath(localPath)
        if (openErr) return { ok: false, error: openErr }
        scheduleUnlinkTemp(localPath)
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    },
  )

  ipcMain.handle('fs:revealInFolder', async (_e: any, workdir: string, rel: string) => {
    try {
      const wd = String(workdir ?? '').trim()
      // 远程没有本地 inode，拉到 /tmp 再「显示」会误导；直接提示用终端
      if (parseSshRoot(wd)) {
        return { ok: false, error: '远程路径无法在访达中显示，请用「在终端中打开目录」' }
      }
      const { path: localPath } = await resolveOpenableLocal(workdir, rel, { allowDir: true })
      // Electron shell.showItemInFolder 在部分 macOS/Electron 组合下会静默失败；open -R 更稳
      if (process.platform === 'darwin') {
        await execFileAsync('open', ['-R', localPath])
      } else {
        shell.showItemInFolder(localPath)
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  ipcMain.handle('fs:openParentInTerminal', async (_e: any, workdir: string, rel: string) => {
    try {
      const wd = String(workdir ?? '').trim()
      const r = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
      const ssh = parseSshRoot(wd)
      if (ssh) {
        const remote = r ? sshJoin(ssh.path, r) : ssh.path
        const probe = await sshRun(
          ssh.host,
          `if [ -d ${shq(remote)} ]; then echo DIR; elif [ -f ${shq(remote)} ]; then echo FILE; else echo MISSING; fi`,
          undefined,
          { timeoutMs: 12000, connectTimeout: 10 },
        )
        if (probe.code !== 0 || probe.out.trim() === 'MISSING') {
          throw new Error(probe.err.trim() || '远程路径不存在')
        }
        const remoteDir = probe.out.trim() === 'DIR' ? remote : path.posix.dirname(remote)
        const script = `ssh -t ${shq(ssh.host)} 'cd ${shq(remoteDir)} && exec $SHELL -l'`
        if (process.platform === 'darwin') {
          await execFileAsync('osascript', [
            '-e',
            `tell application "Terminal" to do script ${JSON.stringify(script)}`,
          ])
        } else {
          spawn('x-terminal-emulator', ['-e', 'bash', '-lc', script], {
            detached: true,
            stdio: 'ignore',
          })
        }
        return { ok: true }
      }

      const resolved = await resolveOpenableLocal(workdir, rel, { allowDir: true })
      const dir = resolved.isDir ? resolved.path : path.dirname(resolved.path)
      if (process.platform === 'darwin') {
        await execFileAsync('open', ['-a', 'Terminal', dir])
      } else if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', 'cmd', '/k', `cd /d ${dir}`], { detached: true, stdio: 'ignore' })
      } else {
        spawn('x-terminal-emulator', ['--working-directory', dir], { detached: true, stdio: 'ignore' })
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  // 工作目录内写文件（仍限制在绑定目录）；上传附件请用 attachments:write，勿直接塞进用户项目
  ipcMain.handle('fs:write', async (_e: any, workdir: string, rel: string, base64: string) => {
    if (typeof base64 !== 'string') throw new Error('content must be base64')
    if (base64.length > 28 * 1024 * 1024) throw new Error('文件过大（上限约 20MB）')
    const sshW = parseSshRoot(String(workdir ?? '').trim())
    if (sshW) {
      const remote = sshJoin(sshW.path, rel)
      const decoded = await sshRun(
        sshW.host,
        `mkdir -p "$(dirname ${shq(remote)})" && base64 -d > ${shq(remote)}`,
        base64.replace(/\s/g, ''),
      )
      if (decoded.code !== 0) throw new Error(decoded.err.trim() || `远程写入失败（exit ${decoded.code}）`)
      return String(rel).replace(/\\/g, '/')
    }
    const file = await resolveInside(workdir, rel, true)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, Buffer.from(base64, 'base64'))
    return path.relative(workdir, file).split(path.sep).join('/')
  })
  // 会话附件：projects/<slug>/uploads/<convId>/ 或 chats/uploads/<convId>/（均在应用 dataDir）
  ipcMain.handle(
    'attachments:write',
    async (_e: any, convId: string, name: string, base64: string, workdir?: string | null) => {
      if (typeof convId !== 'string' || !convId.trim()) throw new Error('convId required')
      if (typeof name !== 'string' || !name.trim()) throw new Error('name required')
      if (typeof base64 !== 'string') throw new Error('content must be base64')
      if (base64.length > 28 * 1024 * 1024) throw new Error('文件过大（上限约 20MB）')
      if (convId.includes('..') || convId.includes('/') || convId.includes('\\')) throw new Error('Invalid convId')
      const safe = name.replace(/[^\w.\u4e00-\u9fff()-]+/g, '_').replace(/^\.+/, '') || 'file'
      const dir = uploadsDirFor(convId, workdir)
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, `${Date.now()}-${safe.slice(0, 120)}`)
      await writeFile(file, Buffer.from(base64, 'base64'))
      // 返回绝对路径，便于消息里告知模型并用 read_file 读取
      return file
    },
  )
  // 删除会话时级联清掉该会话 uploads 目录，并尽量删掉登记过的绝对路径（兼容旧扁平 uploads）
  ipcMain.handle(
    'attachments:purge',
    async (_e: any, convId: string, workdir?: string | null, extraPaths?: string[]) => {
      if (typeof convId !== 'string' || !convId.trim()) throw new Error('convId required')
      if (convId.includes('..') || convId.includes('/') || convId.includes('\\')) throw new Error('Invalid convId')
      const dir = uploadsDirFor(convId, workdir)
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      // 纯 chat 进程沙箱一并清掉
      await rm(localProcessSandboxDir(convId), { recursive: true, force: true }).catch(() => undefined)
      for (const p of Array.isArray(extraPaths) ? extraPaths : []) {
        if (typeof p !== 'string' || !path.isAbsolute(p)) continue
        try {
          const actual = await realpath(p)
          if (isUnderUploads(actual)) await rm(actual, { force: true })
        } catch {
          // 已不存在则忽略
        }
      }
    },
  )

  /** 纯 chat：确保本机进程隔离沙箱目录存在（mock；后续可换 docker/remote） */
  ipcMain.handle('sandbox:ensure', async (_e: any, convId: string) => {
    return ensureLocalProcessSandbox(convId)
  })
  ipcMain.handle('sandbox:info', async (_e: any, convId: string) => {
    const id = String(convId ?? '').trim()
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      return { backend: 'local-process' as const, root: '', ready: false }
    }
    const root = localProcessSandboxDir(id)
    return { backend: 'local-process' as const, root, ready: existsSync(root) }
  })

  /**
   * 导出文件到用户选择的位置（附件绝对路径，或 workdir+rel）。
   * 纯 chat 产物：workdir=沙箱根，rel=产物相对路径。
   */
  ipcMain.handle(
    'fs:exportFile',
    async (
      _e: any,
      opts: { workdir?: string; rel?: string; absPath?: string; defaultName?: string },
    ) => {
      try {
        const abs =
          typeof opts?.absPath === 'string' && opts.absPath.trim()
            ? opts.absPath.trim()
            : ''
        const wd = typeof opts?.workdir === 'string' ? opts.workdir.trim() : ''
        const rel = typeof opts?.rel === 'string' ? opts.rel.trim() : ''
        const src = abs
          ? await resolveReadable('', abs)
          : await resolveReadable(wd, rel)
        const info = await stat(src)
        if (!info.isFile()) return { ok: false, error: '不是文件' }
        const suggested =
          (typeof opts?.defaultName === 'string' && opts.defaultName.trim()) ||
          path.basename(src)
        const focused = BrowserWindow.getFocusedWindow()
        const result = await dialog.showSaveDialog(focused as any, {
          title: '保存文件',
          defaultPath: suggested,
        })
        if (result.canceled || !result.filePath) return { ok: false, canceled: true }
        await cp(src, result.filePath)
        return { ok: true, path: result.filePath }
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    },
  )
  ipcMain.handle('dialog:selectDirectory', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(focusedWindow as any, {
      properties: ['openDirectory'],
      title: '选择工作目录',
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  /** 用系统默认浏览器打开外链 */
  ipcMain.handle('shell:openExternal', async (_e: any, url: string) => {
    const raw = typeof url === 'string' ? url.trim() : ''
    if (!/^https?:\/\//i.test(raw)) return { ok: false, error: '仅支持 http(s) 链接' }
    try {
      await shell.openExternal(raw)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  /** 递归目录体积（字节）；跟随目录，忽略无法读的项 */
  async function dirBytes(root: string): Promise<number> {
    let total = 0
    const stack = [root]
    while (stack.length) {
      const cur = stack.pop()!
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        const p = path.join(cur, ent.name)
        try {
          if (ent.isDirectory()) stack.push(p)
          else if (ent.isFile() || ent.isSymbolicLink()) {
            const st = await stat(p)
            total += st.size
          }
        } catch {
          /* skip */
        }
      }
    }
    return total
  }

  /** 应用数据目录占用：总大小 + 一级子项（目录再带一层子项） */
  ipcMain.handle('storage:usage', async () => {
    const root = dataDir()
    await mkdir(root, { recursive: true })
    type Entry = {
      name: string
      rel: string
      bytes: number
      kind: 'dir' | 'file'
      children?: { name: string; rel: string; bytes: number; kind: 'dir' | 'file' }[]
    }
    const entries: Entry[] = []
    let totalBytes = 0
    let listing: import('node:fs').Dirent[] = []
    try {
      listing = await readdir(root, { withFileTypes: true })
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e), root, totalBytes: 0, entries: [] }
    }
    for (const ent of listing) {
      if (ent.name.startsWith('.')) continue
      const abs = path.join(root, ent.name)
      try {
        if (ent.isDirectory()) {
          const children: NonNullable<Entry['children']> = []
          let bytes = 0
          const kids = await readdir(abs, { withFileTypes: true })
          for (const kid of kids) {
            if (kid.name.startsWith('.')) continue
            const kidAbs = path.join(abs, kid.name)
            try {
              if (kid.isDirectory()) {
                const b = await dirBytes(kidAbs)
                children.push({
                  name: kid.name,
                  rel: `${ent.name}/${kid.name}`,
                  bytes: b,
                  kind: 'dir',
                })
                bytes += b
              } else if (kid.isFile() || kid.isSymbolicLink()) {
                const st = await stat(kidAbs)
                children.push({
                  name: kid.name,
                  rel: `${ent.name}/${kid.name}`,
                  bytes: st.size,
                  kind: 'file',
                })
                bytes += st.size
              }
            } catch {
              /* skip */
            }
          }
          children.sort((a, b) => b.bytes - a.bytes)
          entries.push({
            name: ent.name,
            rel: ent.name,
            bytes,
            kind: 'dir',
            children: children.slice(0, 40),
          })
          totalBytes += bytes
        } else if (ent.isFile() || ent.isSymbolicLink()) {
          const st = await stat(abs)
          entries.push({
            name: ent.name,
            rel: ent.name,
            bytes: st.size,
            kind: 'file',
          })
          totalBytes += st.size
        }
      } catch {
        /* skip */
      }
    }
    entries.sort((a, b) => b.bytes - a.bytes)
    return { ok: true, root, totalBytes, entries }
  })

  ipcMain.handle('storage:reveal', async () => {
    const root = dataDir()
    await mkdir(root, { recursive: true })
    const err = await shell.openPath(root)
    if (err) return { ok: false, error: err }
    return { ok: true, root }
  })

  // 读取 ~/.ssh/config 的 Host 别名（含可选 HostName/User/Port），供「新建远程任务」选择
  ipcMain.handle('ssh:listHosts', async () => {
    const file = path.join(os.homedir(), '.ssh', 'config')
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return []
    }
    const hosts: { host: string; hostname?: string; user?: string; port?: string }[] = []
    let cur: (typeof hosts)[number] | null = null
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = /^(\S+)\s+(.+)$/.exec(line)
      if (!m) continue
      const key = m[1]!.toLowerCase()
      const val = m[2]!.trim()
      if (key === 'host') {
        // 排除通配符块（Host * / Host *.example.com）
        if (!/[*?]/.test(val)) {
          cur = { host: val }
          hosts.push(cur)
        } else {
          cur = null
        }
      } else if (cur) {
        if (key === 'hostname') cur.hostname = val
        else if (key === 'user') cur.user = val
        else if (key === 'port') cur.port = val
      }
    }
    return hosts
  })

  // 通过 ssh 列出远程目录的子目录（非交互、短超时），供「新建远程任务」浏览选择
  ipcMain.handle('ssh:listDirs', async (_e: any, host: string, dir: string) => {
    const h = String(host ?? '').trim()
    if (!h) throw new Error('host required')
    const base = String(dir ?? '').trim() || '~'
    // 仅列目录，逐项一行；~ 由远程 shell 展开（走 ControlMaster）
    const script = `cd ${shq(base)} 2>/dev/null && for d in */; do echo "$d"; done`
    try {
      const { out, err, code } = await sshRun(h, script, undefined, {
        timeoutMs: 9000,
        connectTimeout: 6,
      })
      if (code !== 0) {
        return { ok: false, error: err.trim() || `ssh 退出码 ${code}`, dirs: [], cwd: base }
      }
      const dirs = out
        .split('\n')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean)
        .sort()
      return { ok: true, dirs, cwd: base }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      return {
        ok: false,
        error: /超时/.test(msg) ? '连接超时' : msg,
        dirs: [],
        cwd: base,
      }
    }
  })

  // 在远程当前浏览目录下新建子目录
  ipcMain.handle('ssh:mkdir', async (_e: any, host: string, parent: string, name: string) => {
    const h = String(host ?? '').trim()
    if (!h) return { ok: false, error: 'host required' }
    const base = String(parent ?? '').trim() || '~'
    const raw = String(name ?? '').trim()
    if (!raw) return { ok: false, error: '目录名不能为空' }
    if (raw.includes('/') || raw.includes('\\') || raw === '.' || raw === '..') {
      return { ok: false, error: '目录名不能包含路径分隔符' }
    }
    const dest =
      base === '~' || base === '/'
        ? base === '~'
          ? `~/${raw}`
          : `/${raw}`
        : `${base.replace(/\/$/, '')}/${raw}`
    try {
      const { err, code } = await sshRun(
        h,
        `mkdir ${shq(dest)}`,
        undefined,
        { timeoutMs: 9000, connectTimeout: 6 },
      )
      if (code !== 0) {
        return { ok: false, error: err.trim() || `ssh 退出码 ${code}`, path: dest }
      }
      return { ok: true, path: dest }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      return { ok: false, error: /超时/.test(msg) ? '连接超时' : msg, path: dest }
    }
  })

  // 轻量连通性探测：顺带预热 ControlMaster，后续列目录可复用
  ipcMain.handle('ssh:ping', async (_e: any, host: string) => {
    const h = String(host ?? '').trim()
    if (!h) return { ok: false, error: 'host required' }
    try {
      const { err, code } = await sshRun(h, 'true', undefined, {
        timeoutMs: 8000,
        connectTimeout: 5,
      })
      return code === 0 ? { ok: true } : { ok: false, error: err.trim() || `ssh 退出码 ${code}` }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      return { ok: false, error: /超时/.test(msg) ? '连接超时' : msg }
    }
  })

  // 技能：<dataDir>/skills/<id>/SKILL.md（L1 目录经 list；L2/L3 经 load_skill）
  ipcMain.handle('skills:root', async () => {
    const root = skillsRoot()
    await mkdir(root, { recursive: true })
    return root
  })
  ipcMain.handle('skills:list', async () => {
    const root = skillsRoot()
    await mkdir(root, { recursive: true })
    const list = await listSkillSummariesInRoot(root)
    // 兼容旧字段：path 指向 SKILL.md
    return list.map((s) => ({ ...s, path: path.join(s.path, 'SKILL.md') }))
  })
  ipcMain.handle('skills:scanExternal', async () => {
    const installed = new Set((await listSkillSummariesInRoot(skillsRoot())).map((s) => s.id))
    const sources: {
      id: string
      label: string
      root: string
      exists: boolean
      skills: {
        id: string
        name: string
        description: string
        path: string
        disableModelInvocation: boolean
        installed: boolean
      }[]
    }[] = []
    for (const src of knownExternalSkillSources()) {
      let exists = false
      try {
        exists = (await stat(src.root)).isDirectory()
      } catch {
        exists = false
      }
      const skills = exists
        ? (await listSkillSummariesInRoot(src.root)).map((s) => ({
            ...s,
            installed: installed.has(s.id),
          }))
        : []
      sources.push({ ...src, exists, skills })
    }
    return { sources }
  })
  async function importSkillDirectory(
    sourcePath: string,
    preferredId?: string,
    overwrite = false,
  ): Promise<{
    id: string
    name: string
    description: string
    path: string
    disableModelInvocation: boolean
    overwritten: boolean
  }> {
    if (!sourcePath || !path.isAbsolute(sourcePath)) {
      throw new Error('sourcePath must be an absolute path')
    }
    const srcStat = await stat(sourcePath)
    if (!srcStat.isDirectory()) throw new Error('sourcePath is not a directory')
    await readFile(path.join(sourcePath, 'SKILL.md'), 'utf8')
    const preferred = preferredId?.trim()
      ? skillSlug(preferredId)
      : skillSlug(path.basename(sourcePath))
    let id = preferred
    const root = skillsRoot()
    await mkdir(root, { recursive: true })
    let dest = path.join(root, id)
    try {
      await stat(dest)
      if (!overwrite) {
        for (let n = 2; ; n++) {
          id = `${preferred}-${n}`
          dest = path.join(root, id)
          try {
            await stat(dest)
          } catch (err: any) {
            if (err.code === 'ENOENT') break
            throw err
          }
        }
      } else {
        await rm(dest, { recursive: true, force: true })
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
    await cp(sourcePath, dest, { recursive: true, dereference: true })
    const raw = await readFile(path.join(dest, 'SKILL.md'), 'utf8')
    const parsed = parseSkillMd(raw)
    return {
      id,
      name: parsed.name || id,
      description: parsed.description || '',
      path: path.join(dest, 'SKILL.md'),
      disableModelInvocation: parsed.disableModelInvocation,
      overwritten: overwrite,
    }
  }

  async function unzipArchive(zipPath: string, destDir: string): Promise<void> {
    await mkdir(destDir, { recursive: true })
    if (process.platform === 'win32') {
      const psZip = zipPath.replace(/'/g, "''")
      const psDest = destDir.replace(/'/g, "''")
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psDest}' -Force`,
      ])
      return
    }
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir])
  }

  /** 在解压目录中找出含 SKILL.md 的技能根目录（支持 zip 根即技能，或一层包装夹） */
  async function findSkillDirsInTree(root: string): Promise<string[]> {
    const out: string[] = []
    try {
      await readFile(path.join(root, 'SKILL.md'), 'utf8')
      out.push(root)
      return out
    } catch {
      // 继续扫子目录
    }
    let entries: any[]
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return out
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue
      const full = path.join(root, entry.name)
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = (await stat(full)).isDirectory()
        } catch {
          continue
        }
      }
      if (!isDir) continue
      try {
        await readFile(path.join(full, 'SKILL.md'), 'utf8')
        out.push(full)
      } catch {
        // 再下一层（常见：zip/技能名/SKILL.md 已覆盖；更深不扫）
      }
    }
    return out
  }

  async function importFromZipPath(
    zipPath: string,
    overwrite = false,
  ): Promise<
    {
      id: string
      name: string
      description: string
      path: string
      disableModelInvocation: boolean
      overwritten: boolean
    }[]
  > {
    if (!zipPath.toLowerCase().endsWith('.zip')) throw new Error('仅支持 .zip 技能包')
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'yagent-skill-'))
    try {
      await unzipArchive(zipPath, tmp)
      const dirs = await findSkillDirsInTree(tmp)
      if (dirs.length === 0) throw new Error('zip 内未找到 SKILL.md')
      const results = []
      for (const dir of dirs) {
        results.push(await importSkillDirectory(dir, path.basename(dir), overwrite))
      }
      return results
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  ipcMain.handle(
    'skills:importExternal',
    async (
      _e: any,
      input: { sourcePath?: string; id?: string; overwrite?: boolean },
    ) => {
      const sourcePath = typeof input?.sourcePath === 'string' ? input.sourcePath.trim() : ''
      return importSkillDirectory(
        sourcePath,
        typeof input?.id === 'string' ? input.id : undefined,
        input?.overwrite === true,
      )
    },
  )
  ipcMain.handle(
    'skills:importZip',
    async (
      _e: any,
      input: { zipPath?: string; zipBase64?: string; fileName?: string; overwrite?: boolean },
    ) => {
      const overwrite = input?.overwrite === true
      let zipPath = typeof input?.zipPath === 'string' ? input.zipPath.trim() : ''
      let tmpZip: string | null = null
      try {
        if (!zipPath && typeof input?.zipBase64 === 'string' && input.zipBase64) {
          tmpZip = path.join(
            os.tmpdir(),
            `yagent-skill-${Date.now()}-${skillSlug(input.fileName || 'pack')}.zip`,
          )
          await writeFile(tmpZip, Buffer.from(input.zipBase64, 'base64'))
          zipPath = tmpZip
        }
        if (!zipPath || !path.isAbsolute(zipPath)) throw new Error('zipPath required')
        return await importFromZipPath(zipPath, overwrite)
      } finally {
        if (tmpZip) await rm(tmpZip, { force: true }).catch(() => undefined)
      }
    },
  )
  ipcMain.handle('skills:pickAndImport', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const properties =
      process.platform === 'darwin'
        ? (['openFile', 'openDirectory', 'multiSelections'] as const)
        : (['openFile', 'multiSelections'] as const)
    const result = await dialog.showOpenDialog(focusedWindow as any, {
      title: '上传技能（文件夹或 .zip）',
      properties: [...properties],
      filters: [
        { name: 'Skill 包', extensions: ['zip'] },
        { name: '全部', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths.length) return { imported: [], canceled: true }
    const imported: {
      id: string
      name: string
      description: string
      path: string
      disableModelInvocation: boolean
      overwritten: boolean
    }[] = []
    const errors: string[] = []
    for (const p of result.filePaths) {
      try {
        const st = await stat(p)
        if (st.isDirectory()) {
          imported.push(await importSkillDirectory(p))
        } else if (p.toLowerCase().endsWith('.zip')) {
          imported.push(...(await importFromZipPath(p)))
        } else {
          errors.push(`${path.basename(p)}: 请选择技能文件夹或 .zip`)
        }
      } catch (err: any) {
        errors.push(`${path.basename(p)}: ${err?.message || String(err)}`)
      }
    }
    return { imported, canceled: false, errors }
  })
  ipcMain.handle('skills:read', async (_e: any, id: string) => {
    const dir = skillDirSafe(id)
    const mdPath = path.join(dir, 'SKILL.md')
    const raw = await readFile(mdPath, 'utf8')
    const parsed = parseSkillMd(raw)
    return {
      id: id.trim(),
      name: parsed.name || id.trim(),
      description: parsed.description || '',
      disableModelInvocation: parsed.disableModelInvocation,
      body: parsed.body,
      content: raw,
      path: mdPath,
    }
  })
  ipcMain.handle(
    'skills:create',
    async (_e: any, input: { name?: string; description?: string; id?: string }) => {
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      if (!name) throw new Error('name required')
      const description = typeof input?.description === 'string' ? input.description.trim() : ''
      let id =
        typeof input?.id === 'string' && input.id.trim() ? skillSlug(input.id) : skillSlug(name)
      const root = skillsRoot()
      await mkdir(root, { recursive: true })
      let dir = path.join(root, id)
      // 重名则加后缀
      for (let n = 2; ; n++) {
        try {
          await stat(dir)
          id = `${skillSlug(name)}-${n}`
          dir = path.join(root, id)
        } catch (err: any) {
          if (err.code === 'ENOENT') break
          throw err
        }
      }
      await mkdir(dir, { recursive: true })
      const content =
        `---\nname: ${name}\ndescription: ${description || name}\n---\n\n# ${name}\n\n在此编写技能说明与步骤。\n`
      const mdPath = path.join(dir, 'SKILL.md')
      await atomicWrite(mdPath, content)
      return {
        id,
        name,
        description: description || name,
        path: mdPath,
        disableModelInvocation: false,
      }
    },
  )
  ipcMain.handle(
    'skills:write',
    async (_e: any, id: string, content: string) => {
      if (typeof content !== 'string') throw new Error('content must be string')
      if (content.length > 512 * 1024) throw new Error('SKILL.md 过大（上限 512KB）')
      const dir = skillDirSafe(id)
      await mkdir(dir, { recursive: true })
      const mdPath = path.join(dir, 'SKILL.md')
      await atomicWrite(mdPath, content)
      const parsed = parseSkillMd(content)
      return {
        id: id.trim(),
        name: parsed.name || id.trim(),
        description: parsed.description || '',
        path: mdPath,
        disableModelInvocation: parsed.disableModelInvocation,
      }
    },
  )
  ipcMain.handle('skills:delete', async (_e: any, id: string) => {
    const dir = skillDirSafe(id)
    await rm(dir, { recursive: true, force: true })
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

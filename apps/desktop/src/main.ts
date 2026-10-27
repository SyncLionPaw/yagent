const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require('electron')
const { spawn, execFile } = require('node:child_process')
const { existsSync } = require('node:fs')
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

/** read_file：工作区内相对路径，或 uploads 下的绝对路径 */
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
    if (isUnderUploads(actual)) return actual
    // 也允许绝对路径落在工作区内
    if (workdir.trim()) {
      const base = await realpath(workdir.trim())
      if (actual === base || actual.startsWith(`${base}${path.sep}`)) return actual
    }
    throw new Error('Absolute path must be under the bound working directory or app uploads/')
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
    const file = await resolveInside(workdir, rel)
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
    if (info.size > 256 * 1024) return unavailable('文件超过 256KB，请在编辑器中打开')
    const buf = await readFile(file)
    if (buf.includes(0)) return unavailable('二进制文件不支持预览')
    return { kind: 'text' as const, content: buf.toString('utf8') }
  })
  // 工作目录内写文件（仍限制在绑定目录）；上传附件请用 attachments:write，勿直接塞进用户项目
  ipcMain.handle('fs:write', async (_e: any, workdir: string, rel: string, base64: string) => {
    if (typeof base64 !== 'string') throw new Error('content must be base64')
    if (base64.length > 28 * 1024 * 1024) throw new Error('文件过大（上限约 20MB）')
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
  ipcMain.handle('dialog:selectDirectory', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(focusedWindow as any, {
      properties: ['openDirectory'],
      title: '选择工作目录',
    })
    return result.canceled ? null : result.filePaths[0] ?? null
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

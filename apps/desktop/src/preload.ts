import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('yagentDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  settings: {
    read: () => ipcRenderer.invoke('settings:read'),
    write: (content: string) => ipcRenderer.invoke('settings:write', content),
  },
  usage: {
    read: () => ipcRenderer.invoke('usage:read'),
    write: (content: string) => ipcRenderer.invoke('usage:write', content),
  },
  insights: {
    write: (insight: unknown) => ipcRenderer.invoke('insights:write', insight),
    read: (id: string) => ipcRenderer.invoke('insights:read', id),
    readMany: (ids: string[]) => ipcRenderer.invoke('insights:readMany', ids),
    listSight: () => ipcRenderer.invoke('insights:listSight'),
    delete: (id: string, opts?: { preserveSight?: boolean }) =>
      ipcRenderer.invoke('insights:delete', id, opts),
    deleteMany: (ids: string[], opts?: { preserveSight?: boolean }) =>
      ipcRenderer.invoke('insights:deleteMany', ids, opts),
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    append: (key: string, lines: string) => ipcRenderer.invoke('conversations:append', key, lines),
    write: (key: string, content: string) => ipcRenderer.invoke('conversations:write', key, content),
    delete: (key: string) => ipcRenderer.invoke('conversations:delete', key),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    remember: (workdir: string) => ipcRenderer.invoke('projects:remember', workdir),
    forget: (workdir: string) => ipcRenderer.invoke('projects:forget', workdir),
  },
  tools: {
    execute: (name: string, input: Record<string, unknown>, workdir: string) =>
      ipcRenderer.invoke('tools:execute', { name, input, workdir }),
  },
  /** 纯 chat 沙箱：当前为 local-process；后续可扩展 docker / remote */
  sandbox: {
    ensure: (convId: string) =>
      ipcRenderer.invoke('sandbox:ensure', convId) as Promise<{
        backend: 'local-process' | 'docker' | 'remote'
        root: string
      }>,
    info: (convId: string) =>
      ipcRenderer.invoke('sandbox:info', convId) as Promise<{
        backend: 'local-process' | 'docker' | 'remote'
        root: string
        ready: boolean
      }>,
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  storage: {
    usage: () => ipcRenderer.invoke('storage:usage'),
    reveal: () => ipcRenderer.invoke('storage:reveal'),
  },
  ssh: {
    listHosts: () => ipcRenderer.invoke('ssh:listHosts'),
    listDirs: (host: string, dir: string) => ipcRenderer.invoke('ssh:listDirs', host, dir),
    mkdir: (host: string, parent: string, name: string) =>
      ipcRenderer.invoke('ssh:mkdir', host, parent, name),
    ping: (host: string) => ipcRenderer.invoke('ssh:ping', host),
  },
  fs: {
    list: (workdir: string, rel: string) => ipcRenderer.invoke('fs:list', workdir, rel),
    read: (workdir: string, rel: string) => ipcRenderer.invoke('fs:read', workdir, rel),
    write: (workdir: string, rel: string, base64: string) =>
      ipcRenderer.invoke('fs:write', workdir, rel, base64),
    openMenu: (workdir: string, rel: string) => ipcRenderer.invoke('fs:openMenu', workdir, rel),
    openWithApp: (workdir: string, rel: string, appPath?: string | null) =>
      ipcRenderer.invoke('fs:openWithApp', workdir, rel, appPath ?? null),
    revealInFolder: (workdir: string, rel: string) =>
      ipcRenderer.invoke('fs:revealInFolder', workdir, rel),
    openParentInTerminal: (workdir: string, rel: string) =>
      ipcRenderer.invoke('fs:openParentInTerminal', workdir, rel),
    exportFile: (opts: {
      workdir?: string
      rel?: string
      absPath?: string
      defaultName?: string
    }) =>
      ipcRenderer.invoke('fs:exportFile', opts) as Promise<{
        ok: boolean
        canceled?: boolean
        path?: string
        error?: string
      }>,
  },
  attachments: {
    write: (convId: string, name: string, base64: string, workdir?: string | null) =>
      ipcRenderer.invoke('attachments:write', convId, name, base64, workdir ?? null),
    purge: (convId: string, workdir?: string | null, extraPaths?: string[]) =>
      ipcRenderer.invoke('attachments:purge', convId, workdir ?? null, extraPaths ?? []),
  },
  skills: {
    root: () => ipcRenderer.invoke('skills:root'),
    list: () => ipcRenderer.invoke('skills:list'),
    scanExternal: () => ipcRenderer.invoke('skills:scanExternal'),
    importExternal: (input: { sourcePath: string; id?: string; overwrite?: boolean }) =>
      ipcRenderer.invoke('skills:importExternal', input),
    importZip: (input: {
      zipPath?: string
      zipBase64?: string
      fileName?: string
      overwrite?: boolean
    }) => ipcRenderer.invoke('skills:importZip', input),
    pickAndImport: () => ipcRenderer.invoke('skills:pickAndImport'),
    read: (id: string) => ipcRenderer.invoke('skills:read', id),
    create: (input: { name: string; description?: string; id?: string }) =>
      ipcRenderer.invoke('skills:create', input),
    write: (id: string, content: string) => ipcRenderer.invoke('skills:write', id, content),
    delete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  },
  /** Electron：从拖放的 File 取本地绝对路径 */
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
})

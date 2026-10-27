import { contextBridge, ipcRenderer } from 'electron'

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
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  },
  fs: {
    list: (workdir: string, rel: string) => ipcRenderer.invoke('fs:list', workdir, rel),
    read: (workdir: string, rel: string) => ipcRenderer.invoke('fs:read', workdir, rel),
    write: (workdir: string, rel: string, base64: string) =>
      ipcRenderer.invoke('fs:write', workdir, rel, base64),
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
    read: (id: string) => ipcRenderer.invoke('skills:read', id),
    create: (input: { name: string; description?: string; id?: string }) =>
      ipcRenderer.invoke('skills:create', input),
    write: (id: string, content: string) => ipcRenderer.invoke('skills:write', id, content),
    delete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  },
})

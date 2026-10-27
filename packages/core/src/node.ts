/* ============ Node 文件系统设置存储：仅 Node / Electron 主进程用，不进根 barrel ============ */
/// <reference types="node" />

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Settings } from './model.js'
import { SettingsStore, type SettingsStorage } from './settings/index.js'

export function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.yagent', 'settings.json')
}

export class NodeFsSettingsStorage implements SettingsStorage {
  constructor(private filePath: string = defaultSettingsPath()) {}

  async read(): Promise<string | null> {
    try {
      return await readFile(this.filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  // 原子写：先写临时文件再 rename 覆盖，防止写一半损坏；tmp 名带随机后缀避免并发互踩
  async write(content: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, this.filePath)
  }
}

export function createFileSettingsStore(
  defaults: Settings,
  filePath: string = defaultSettingsPath(),
): SettingsStore {
  return new SettingsStore(new NodeFsSettingsStorage(filePath), defaults)
}

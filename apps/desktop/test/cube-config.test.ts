import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cubePing } from '../src/sandbox-providers/cube.js'
import {
  cubeRootFor,
  loadCubeConfig,
  pageFileText,
  parseCubeRoot,
  resolveSandboxPath,
} from '../src/sandbox-providers/cube-config.js'

let tempDir: string

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('cube provider config', () => {
  it('stays off when the sidecar file is absent', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'yagent-cube-'))
    expect(await loadCubeConfig(tempDir)).toBeNull()
  })

  it('reads the sidecar and can be switched off without deleting it', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'yagent-cube-'))
    const file = path.join(tempDir, 'providers', 'cube.json')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      JSON.stringify({
        apiUrl: 'http://10.0.0.8:3000/',
        templateId: 'tpl-abc',
        proxyNodeIp: '10.0.0.8',
        proxyPort: 80,
        proxyScheme: 'http',
      }),
    )
    const cfg = await loadCubeConfig(tempDir)
    expect(cfg?.apiUrl).toBe('http://10.0.0.8:3000')
    expect(cfg?.templateId).toBe('tpl-abc')
    expect(cfg?.workdir).toBe('/root')
    expect(cfg?.place).toBe('10.0.0.8')

    await writeFile(
      file,
      JSON.stringify({
        apiUrl: 'http://10.0.0.8:3000',
        templateId: 'tpl-abc',
        label: 'wanglab',
      }),
    )
    expect((await loadCubeConfig(tempDir))?.place).toBe('wanglab')

    await writeFile(file, JSON.stringify({ enabled: false, apiUrl: 'http://10.0.0.8:3000', templateId: 'tpl-abc' }))
    expect(await loadCubeConfig(tempDir)).toBeNull()
  })

  it('prefers settings and turns the provider off when the sandbox is local', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'yagent-cube-'))
    const file = path.join(tempDir, 'providers', 'cube.json')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ apiUrl: 'http://10.0.0.8:3000', templateId: 'tpl-file' }))
    await writeFile(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({
        sandbox: {
          env: 'sandbox',
          provider: { apiUrl: 'http://10.1.1.1:3000/', templateId: 'tpl-settings', label: 'lab' },
        },
      }),
    )
    const cfg = await loadCubeConfig(tempDir)
    expect(cfg?.apiUrl).toBe('http://10.1.1.1:3000')
    expect(cfg?.templateId).toBe('tpl-settings')
    expect(cfg?.place).toBe('lab')
    expect(cfg?.proxyNodeIp).toBe('10.1.1.1')

    await writeFile(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({ sandbox: { env: 'local', provider: { apiUrl: 'http://10.1.1.1:3000', templateId: 'tpl-settings' } } }),
    )
    expect(await loadCubeConfig(tempDir)).toBeNull()
  })

  it('lets the open settings page rename the sandbox before the file is saved', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'yagent-cube-'))
    const file = path.join(tempDir, 'providers', 'cube.json')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ apiUrl: 'http://10.0.0.8:3000', templateId: 'tpl-file' }))
    const live = await loadCubeConfig(tempDir, {
      env: 'sandbox',
      provider: { apiUrl: 'http://10.9.9.9:3000', templateId: 'tpl-live', label: 'now' },
    })
    expect(live?.place).toBe('now')
    expect(live?.templateId).toBe('tpl-live')
    expect(await loadCubeConfig(tempDir, { env: 'local' })).toBeNull()
  })

  it('treats a local env as connected without calling the network', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'yagent-cube-'))
    const live = await cubePing(tempDir, {
      env: 'local',
      provider: { apiUrl: 'http://127.0.0.1:1', templateId: 'tpl-dead' },
    })
    expect(live).toEqual({ mode: 'local', ok: true, label: '本机' })
  })

  it('reports a refused cube endpoint as disconnected', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'yagent-cube-'))
    const live = await cubePing(tempDir, {
      env: 'sandbox',
      provider: { apiUrl: 'http://127.0.0.1:1', templateId: 'tpl-dead', label: 'gone' },
    })
    expect(live.mode).toBe('remote')
    expect(live.ok).toBe(false)
    expect(live.label).toBe('gone')
    expect(live.error).toBeTruthy()
  })

  it('uses a cube:// root that local and ssh paths do not match', () => {
    expect(cubeRootFor('conv-1')).toBe('cube://conv-1')
    expect(parseCubeRoot('cube://conv-1')).toBe('conv-1')
    expect(parseCubeRoot('/tmp/sandboxes/conv-1')).toBeNull()
    expect(parseCubeRoot('ssh://host/repo')).toBeNull()
    expect(() => cubeRootFor('../x')).toThrow(/Invalid convId/)
  })

  it('keeps relative paths under the sandbox workdir and allows absolute paths inside the vm', () => {
    expect(resolveSandboxPath('/home/user', 'src/a.py')).toBe('/home/user/src/a.py')
    expect(resolveSandboxPath('/home/user', '/tmp/a.txt')).toBe('/tmp/a.txt')
    expect(() => resolveSandboxPath('/home/user', '../etc/passwd')).toThrow(/escapes/)
    expect(() => resolveSandboxPath('/home/user', '/../etc/passwd')).toThrow(/escapes/)
  })

  it('pages file text the same way the local reader does', () => {
    const text = pageFileText('/home/user/a.txt', 'one\ntwo\nthree', 2, 1)
    expect(text).toContain('[PARTIAL] /home/user/a.txt: lines 2-2 of 3')
    expect(text).toContain('L2: two')
  })
})

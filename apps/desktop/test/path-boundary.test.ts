// @vitest-environment node

import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveInside, sshCanonicalBoundaryPrelude, sshJoin } from '../src/path-boundary.js'

const execFileAsync = promisify(execFile)

let tempDir: string
let root: string
let outside: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'yagent-path-boundary-'))
  root = path.join(tempDir, 'root')
  outside = path.join(tempDir, 'outside')
  await mkdir(root)
  await mkdir(outside)
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('local path boundary', () => {
  it('resolves new nested files inside the real working directory', async () => {
    const resolved = await resolveInside(root, 'nested/new.txt', true)
    expect(resolved).toBe(path.join(await realpath(root), 'nested', 'new.txt'))
  })

  it('rejects lexical traversal and absolute paths', async () => {
    await expect(resolveInside(root, '../outside.txt', true)).rejects.toThrow(/outside/)
    await expect(resolveInside(root, path.join(outside, 'absolute.txt'), true)).rejects.toThrow(
      /outside/,
    )
  })

  it('rejects both existing and missing targets reached through an escaping symlink', async () => {
    await writeFile(path.join(outside, 'existing.txt'), 'do not read')
    await symlink(outside, path.join(root, 'link'))

    await expect(resolveInside(root, 'link/existing.txt')).rejects.toThrow(/outside/)
    await expect(resolveInside(root, 'link/new.txt', true)).rejects.toThrow(/outside/)
    await expect(access(path.join(outside, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('SSH path boundary', () => {
  it('joins ordinary remote relative paths without silently accepting escapes', () => {
    expect(sshJoin('~/project', 'nested/file.txt')).toBe('~/project/nested/file.txt')
    expect(sshJoin('~', './file.txt')).toBe('~/./file.txt')
    expect(sshJoin('/srv/project', 'file.txt')).toBe('/srv/project/file.txt')
    expect(() => sshJoin('~', '..')).toThrow(/escapes/)
    expect(() => sshJoin('~', '/etc/passwd')).toThrow(/Absolute/)
    expect(() => sshJoin('~', 'C:/Windows/win.ini')).toThrow(/Absolute/)
    expect(() => sshJoin('~', 'nested/../../outside')).toThrow(/escapes/)
  })

  it('allows in-root writes but fails closed on unsupported shells or symlink escapes', async () => {
    const writeInRoot = `${sshCanonicalBoundaryPrelude(root, 'nested/new.txt')}\nmkdir -p -- "$(dirname -- "$target")" && printf ok > "$target"`
    let supportsCanonicalMissingPaths = true
    try {
      await execFileAsync('/bin/sh', ['-c', 'realpath -m -- / >/dev/null 2>&1 || readlink -m -- / >/dev/null 2>&1'])
    } catch {
      supportsCanonicalMissingPaths = false
    }
    if (supportsCanonicalMissingPaths) {
      await execFileAsync('/bin/sh', ['-c', writeInRoot])
      await expect(realpath(path.join(root, 'nested', 'new.txt'))).resolves.toContain(root)
    } else {
      // macOS 的 realpath/readlink 没有 -m：必须拒绝写入，不能退化为词法检查。
      await expect(execFileAsync('/bin/sh', ['-c', writeInRoot])).rejects.toMatchObject({ code: 5 })
    }

    await symlink(outside, path.join(root, 'link'))
    await expect(
      execFileAsync('/bin/sh', [
        '-c',
        `${sshCanonicalBoundaryPrelude(root, 'link/escape.txt')}\nmkdir -p -- "$(dirname -- "$target")" && printf bad > "$target"`,
      ]),
    ).rejects.toMatchObject({ code: 5 })
    await expect(access(path.join(outside, 'escape.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

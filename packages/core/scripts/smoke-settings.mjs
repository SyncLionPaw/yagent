/* 冒烟：SettingsStore 行为（defaults / 保存格式 / 合并迁移 / 损坏回退 / 原子写）。用法：pnpm build && node scripts/smoke-settings.mjs */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeSettings } from '../dist/index.js'
import { NodeFsSettingsStorage, createFileSettingsStore, defaultSettingsPath } from '../dist/node.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagent-settings-'))
const file = path.join(dir, 'settings.json')

const defaults = {
  models: [
    { id: 'm-a', name: 'A', provider: 'anthropic', modelId: 'a', context: 200000 },
    { id: 'm-b', name: 'B', provider: 'openai', modelId: 'b', context: 128000 },
  ],
  memories: [],
  tools: { terminal: true, fileEdit: true, webSearch: false },
  sandbox: { env: 'sandbox', workdir: '~/yagent', network: true },
}

assert.ok(defaultSettingsPath().endsWith(path.join('.yagent', 'settings.json')), '默认路径是 ~/.yagent/settings.json')

/* ---- 场景 1：文件不存在 → load 返回 defaults（引用同一默认值） ---- */
{
  const store = createFileSettingsStore(defaults, file)
  const s = await store.load()
  assert.equal(s, defaults, '文件不存在时返回 defaults 本身')
}

/* ---- 场景 2：save → 文件存在、2 空格缩进、结尾换行；再次 load deep equal ---- */
{
  const store = createFileSettingsStore(defaults, file)
  await store.save(defaults)
  const content = fs.readFileSync(file, 'utf8')
  assert.equal(content, JSON.stringify(defaults, null, 2) + '\n', '保存格式：2 空格缩进 + 结尾换行')
  const store2 = createFileSettingsStore(defaults, file)
  assert.deepEqual(await store2.load(), defaults, '再次 load deep equal')
}

/* ---- 场景 3：部分字段 → mergeSettings 合并（models 迁移：缺省条目补上、用户条目保留）；
   旧版顶层 apiKeys 迁移进对应 provider 的模型条目，且不再出现在结果里 ---- */
{
  const userModel = { id: 'm-x', name: 'X', provider: 'custom', modelId: 'x', context: 8192 }
  const saved = {
    models: [userModel, { id: 'm-a', name: 'A', provider: 'anthropic', modelId: 'a', context: 200000 }],
    apiKeys: { anthropic: 'sk-test', customEndpoint: 'https://x.dev/v1', customKey: 'sk-c' },
    tools: { webSearch: true },
  }
  fs.writeFileSync(file, JSON.stringify(saved))
  const store = createFileSettingsStore(defaults, file)
  const s = await store.load()
  assert.deepEqual(
    s.models.map((m) => m.id),
    ['m-x', 'm-a', 'm-b'],
    '用户模型保留、缺省默认条目补上',
  )
  assert.equal(s.models.find((m) => m.id === 'm-a').apiKey, 'sk-test', '旧 apiKeys 按 provider 迁入模型')
  const custom = s.models.find((m) => m.id === 'm-x')
  assert.equal(custom.baseURL, 'https://x.dev/v1', 'custom 端点迁入')
  assert.equal(custom.apiKey, 'sk-c', 'custom key 迁入')
  assert.equal('apiKeys' in s, false, '结果不再携带旧 apiKeys 字段')
  assert.deepEqual(s.tools, { terminal: true, fileEdit: true, webSearch: true }, 'tools 浅合并')
  assert.deepEqual(s.sandbox, defaults.sandbox, 'sandbox 缺失回退 defaults')
  assert.deepEqual(mergeSettings(defaults, {}).models, defaults.models, '空 saved 时 models 取 defaults')
}

/* ---- 场景 4：损坏 JSON → load 回退 defaults 且文件内容未被覆写 ---- */
{
  fs.writeFileSync(file, '{ broken json')
  const store = createFileSettingsStore(defaults, file)
  const s = await store.load()
  assert.deepEqual(s, defaults, '损坏文件回退 defaults')
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken json', '损坏文件不被覆写')
}

/* ---- 场景 5：重复 / 并发 save 后文件内容完整（原子写间接验证） ---- */
{
  const store = createFileSettingsStore(defaults, file)
  for (let i = 0; i < 50; i++) {
    await store.save({ ...defaults, memories: [{ id: `m${i}`, text: `t${i}`, sourceCount: 1, updatedAt: i }] })
  }
  let content = fs.readFileSync(file, 'utf8')
  assert.equal(JSON.parse(content).memories[0].id, 'm49', '重复 save 后内容为最后一次写入')
  assert.ok(content.endsWith('\n'), '结尾换行保留')

  const storage = new NodeFsSettingsStorage(file)
  const same = JSON.stringify(defaults, null, 2) + '\n'
  await Promise.all(Array.from({ length: 10 }, () => storage.write(same)))
  content = fs.readFileSync(file, 'utf8')
  assert.equal(content, same, '并发 save 后文件完整无残缺')
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.includes('.tmp')),
    [],
    'tmp 文件已 rename 清理',
  )
}

fs.rmSync(dir, { recursive: true, force: true })
console.log('smoke-settings: all assertions passed')

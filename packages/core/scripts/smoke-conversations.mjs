/* 冒烟：JSONL 会话存储（codec fold / store 追加落盘 / 项目分目录 key / 压缩 / 恢复 / 删除 / 旧格式兼容）。
 * 用法：pnpm build && node scripts/smoke-conversations.mjs */
import assert from 'node:assert/strict'
import {
  ConversationStore,
  Harness,
  conversationKey,
  encodeConversation,
  decodeConversation,
  slugifyWorkdir,
} from '../dist/index.js'

/** 内存版 ConversationStorage（key → text） */
function memStorage() {
  const map = new Map()
  return {
    map,
    appends: 0,
    writes: 0,
    async list() {
      return [...map.entries()].map(([key, text]) => ({ key, text }))
    },
    async append(key, lines) {
      this.appends++
      map.set(key, (map.get(key) ?? '') + lines)
    },
    async write(key, content) {
      this.writes++
      map.set(key, content)
    },
    async delete(key) {
      map.delete(key)
    },
  }
}

const fakeProvider = {
  async *streamChat() {
    yield { type: 'text_delta', text: '你好' }
    yield { type: 'done' }
  },
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

/* ---- 场景 1：key 布局——绑定目录进 projects/<slug>/，纯对话进 chats/ ---- */
{
  assert.equal(slugifyWorkdir('/Users/gyl/yagent'), 'Users-gyl-yagent')
  assert.equal(slugifyWorkdir('C:\\code\\my app'), 'code-my-app')
  const harness = new Harness({ provider: fakeProvider, model: 'test' })
  const task = harness.createConversation('任务', '/Users/gyl/yagent')
  const chat = harness.createConversation('聊天', null)
  assert.equal(conversationKey(task), `projects/Users-gyl-yagent/${task.id}.jsonl`)
  assert.equal(conversationKey(chat), `chats/${chat.id}.jsonl`)
}

/* ---- 场景 2：codec 往返 + upsert + meta 合并 + 坏行容忍 ---- */
{
  const harness = new Harness({ provider: fakeProvider, model: 'test' })
  const conv = harness.createConversation('往返', '/tmp/w')
  await harness.sendMessage(conv.id, 'hi')

  const full = encodeConversation(conv)
  const decoded = decodeConversation(full)
  assert.deepEqual(decoded.nodes, conv.nodes, '节点往返一致')
  assert.equal(decoded.workdir, '/tmp/w', 'workdir 保留')

  const roundNode = Object.values(conv.nodes)[0]
  const updated = { ...roundNode, durationMs: 999 }
  const extra =
    full +
    '{ broken json\n' +
    JSON.stringify({ _meta: { title: '改名了' } }) + '\n' +
    JSON.stringify(updated).slice(0, 20) + '\n' + // 截断半行
    JSON.stringify(updated) + '\n'
  const d2 = decodeConversation(extra)
  assert.equal(d2.title, '改名了', 'meta 后写赢')
  assert.equal(d2.nodes[roundNode.id].durationMs, 999, '节点后写覆盖先写')
  assert.equal(Object.keys(d2.nodes).length, Object.keys(conv.nodes).length, '坏行不产生新节点')
}

/* ---- 场景 3：发消息 → 按 key 追加落盘；空会话不落盘 ---- */
{
  const storage = memStorage()
  const harness = new Harness({ provider: fakeProvider, model: 'test' })
  new ConversationStore(harness, storage)
  const conv = harness.createConversation('追加', '/tmp/proj')
  await harness.sendMessage(conv.id, 'hi')
  await tick()
  const key = conversationKey(conv)
  assert.ok(storage.map.has(key), `按项目 key 落盘（${key}）`)
  assert.ok(storage.appends > 0, '走了 append')
  assert.equal(storage.writes, 0, '未触发压缩重写')
  const decoded = decodeConversation(storage.map.get(key))
  assert.deepEqual(Object.keys(decoded.nodes).sort(), Object.keys(conv.nodes).sort(), '节点完整')

  harness.createConversation('空会话', null)
  await tick(700)
  assert.equal(storage.map.size, 1, '空会话不落盘')
}

/* ---- 场景 4：压缩——脏行数超阈值后整体重写 ---- */
{
  const storage = memStorage()
  const harness = new Harness({ provider: fakeProvider, model: 'test' })
  const store = new ConversationStore(harness, storage, { compactMinLines: 10 })
  const conv = harness.createConversation('压缩', null)
  await harness.sendMessage(conv.id, 'hi')
  for (let i = 0; i < 20; i++) {
    harness.rename(conv.id, `压缩 ${i}`)
    store.flush(conv.id)
  }
  await tick()
  assert.ok(storage.writes > 0, '触发了压缩重写')
  const text = storage.map.get(conversationKey(conv))
  const lines = text.split('\n').filter((l) => l.trim()).length
  assert.ok(lines < 15, `压缩生效（实际 ${lines} 行，无压缩应为 23 行）`)
  assert.equal(decodeConversation(text).title, '压缩 19', '压缩后内容是最新状态')
}

/* ---- 场景 5：恢复 + 旧格式兼容 + 换 key 迁移（旧路径删除） ---- */
{
  const storage = memStorage()
  const harness = new Harness({ provider: fakeProvider, model: 'test' })
  const store = new ConversationStore(harness, storage)
  const conv = harness.createConversation('旧会话', '/tmp/work')
  await harness.sendMessage(conv.id, 'hi')
  await tick()

  // 模拟旧版平铺存储：整文件单 blob JSON，key 是老式 <id>.json，且死于流式中途
  storage.map.clear()
  storage.map.set(`${conv.id}.json`, JSON.stringify({ ...conv, status: 'running' }))
  storage.map.set('broken.json', '{ not json at all')
  // pretty-print 多行的整文件 JSON（旧格式变体）
  storage.map.set('pretty.json', JSON.stringify({
    id: 'pretty', title: '美化格式', workdir: '/tmp/pp', status: 'done', activeNodeId: 'u1',
    refs: [], attachments: [], outputs: [],
    nodes: { u1: { id: 'u1', parentId: null, role: 'user', blocks: [{ type: 'text', text: 'p' }], createdAt: 1 } },
  }, null, 2))

  const harness2 = new Harness({ provider: fakeProvider, model: 'test' })
  const store2 = new ConversationStore(harness2, storage)
  const loaded = await store2.loadAll()
  assert.equal(loaded, 2, '坏记录跳过，恢复 2 条（blob 旧格式 + pretty-print 变体）')
  const restored = harness2.getConversation(conv.id)
  assert.equal(restored.status, 'done', 'running 归一化为 done')
  assert.equal(restored.workdir, '/tmp/work', 'workdir 保留')
  assert.equal(harness2.getConversation('pretty').workdir, '/tmp/pp', 'pretty-print 整文件可读')

  // 恢复后再有一次写入 → 写到新 key，旧 key 被清理
  harness2.rename(conv.id, '迁移')
  store2.flush(conv.id)
  await tick()
  const newKey = conversationKey(conv)
  assert.ok(storage.map.has(newKey), `写到新 key（${newKey}）`)
  assert.ok(!storage.map.has(`${conv.id}.json`), '旧平铺文件已删除')
}

/* ---- 场景 6：remove → 存储和 harness 同时清掉 ---- */
{
  const storage = memStorage()
  const harness = new Harness({ provider: fakeProvider, model: 'test' })
  const store = new ConversationStore(harness, storage)
  const conv = harness.createConversation('要删的', '/tmp/p')
  await harness.sendMessage(conv.id, 'hi')
  await tick()
  assert.equal(storage.map.size, 1)
  await store.remove(conv.id)
  assert.equal(storage.map.size, 0, '存储已删')
  assert.equal(harness.getConversation(conv.id), undefined, 'harness 已删')
}

console.log('smoke-conversations: all assertions passed')

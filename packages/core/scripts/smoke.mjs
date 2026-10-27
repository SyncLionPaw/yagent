/* 冒烟：MockProvider 跑通 agent loop。用法：pnpm build && node scripts/smoke.mjs */
import assert from 'node:assert/strict'
import { Harness, MockProvider } from '../dist/index.js'

const events = []
const executorCalls = []

const harness = new Harness({
  provider: new MockProvider({ charDelayMs: 1 }),
  model: 'mock-1',
  tools: [
    {
      name: 'bash',
      description: 'run a shell command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    },
  ],
  executor: async (name, input) => {
    executorCalls.push({ name, input })
    return 'file1.ts\nfile2.ts'
  },
})
harness.on((e) => events.push(e))

/* ---- 场景 1：完整 loop（thinking → text → tool_use → executor → 收尾 → done） ---- */
const conv = harness.createConversation('smoke', '~/yagent')
await harness.sendMessage(conv.id, '帮我看看目录')

const types = events.map((e) => e.type)
const iThinking = types.indexOf('thinking_delta')
const iText = types.indexOf('text_delta')
const iToolRunning = events.findIndex((e) => e.type === 'tool_status' && e.status === 'running')
const iToolDone = events.findIndex((e) => e.type === 'tool_status' && e.status === 'done')

const firstAdded = events.find((e) => e.type === 'node_added')
assert.equal(firstAdded.node.role, 'round', '首个节点是 round（一轮问答一个节点）')
assert.ok(events.some((e) => e.type === 'conv_status_changed' && e.status === 'running'), '进入 running')
assert.ok(iThinking > -1, '有 thinking_delta')
assert.ok(iText > iThinking, 'text_delta 在 thinking_delta 之后')
assert.ok(iToolRunning > iText, 'tool running 在 text 之后')
assert.ok(iToolDone > iToolRunning, 'tool done 在 running 之后')
assert.equal(executorCalls.length, 1, 'executor 被调用一次')
assert.equal(executorCalls[0].name, 'bash')
assert.deepEqual(executorCalls[0].input, { command: 'ls' })
const last = events.at(-1)
assert.deepEqual({ type: last.type, status: last.status }, { type: 'conv_status_changed', status: 'done' }, '最终状态 done')

/* ---- 节点结构：一轮问答 = 一个 round 节点，所有块都在里面 ---- */
const c = harness.getConversation(conv.id)
const nodes = Object.values(c.nodes)
assert.equal(nodes.length, 1, '一轮问答只产生一个节点')
const round = nodes[0]
assert.equal(round.role, 'round')
assert.equal(round.blocks[0].type, 'text', '首块是用户输入')
assert.equal(c.activeNodeId, round.id, 'activeNode 就是 round 节点')
assert.equal(c.status, 'done')

const thinkingBlock = round.blocks.find((b) => b.type === 'thinking')
assert.equal(thinkingBlock.status, 'done', 'thinking 块收尾为 done')
assert.ok(typeof thinkingBlock.durationMs === 'number', 'thinking 有耗时')
const toolBlock = round.blocks.find((b) => b.type === 'tool')
assert.equal(toolBlock.status, 'done')
assert.equal(toolBlock.summary, 'ls')
assert.ok(toolBlock.detail.includes('file1.ts'), 'tool detail 带 executor 输出')
assert.ok(toolBlock.toolUseId, 'tool 块带 toolUseId')
const resultBlock = round.blocks.find((b) => b.type === 'tool_result')
assert.equal(resultBlock.content, 'file1.ts\nfile2.ts', 'tool_result 追加在同一节点')
assert.ok(round.blocks.some((b) => b.type === 'text' && b.text.includes('MockProvider')), '收尾文本')
assert.ok(round.durationMs >= 0, 'round 节点有 durationMs')

/* ---- 场景 2：abort → 状态 waiting ---- */
const events2 = []
const slow = new Harness({ provider: new MockProvider(), model: 'mock-1' }) // 默认 30ms/字
slow.on((e) => events2.push(e))
const conv2 = slow.createConversation('abort-case', null)
const p = slow.sendMessage(conv2.id, '别跑了')
setTimeout(() => slow.abort(conv2.id), 5)
await p
const c2 = slow.getConversation(conv2.id)
assert.equal(c2.status, 'waiting', 'abort 后标记 waiting')
assert.ok(events2.some((e) => e.type === 'conv_status_changed' && e.status === 'running'), '进入过 running')
assert.ok(!events2.some((e) => e.type === 'error'), 'abort 不产生 error 事件')

/* ---- 场景 3：无 executor → tool not available ---- */
const plain = new Harness({ provider: new MockProvider({ charDelayMs: 1 }), model: 'mock-1' })
const conv3 = plain.createConversation('no-executor', null)
await plain.sendMessage(conv3.id, '试一下')
const c3 = plain.getConversation(conv3.id)
const resultBlock3 = Object.values(c3.nodes)[0].blocks.find((b) => b.type === 'tool_result')
assert.equal(resultBlock3.content, 'tool not available')
assert.equal(c3.status, 'done')

/* ---- 场景 4：生命周期钩子（HarnessHooks） ---- */
const hookCalls = []
const hooked = new Harness({
  provider: new MockProvider({ charDelayMs: 1 }),
  model: 'mock-1',
  tools: [
    {
      name: 'bash',
      description: 'run a shell command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    },
  ],
  executor: async () => 'hook-ok',
  hooks: {
    onConversationCreated: (c) => hookCalls.push(['onConversationCreated', c.title]),
    onNodeAdded: (c, n) => hookCalls.push(['onNodeAdded', n.role, n.blocks[0]?.type]),
    onTurnStart: (c, n) => hookCalls.push(['onTurnStart', n.role]),
    onToolStart: (c, n, call) => hookCalls.push(['onToolStart', call.name]),
    onToolEnd: (c, n, call, result) => hookCalls.push(['onToolEnd', call.name, result.isError]),
    onError: (c, err) => hookCalls.push(['onError', err.message]),
    onRunEnd: (c, reason) => hookCalls.push(['onRunEnd', reason]),
  },
})
const conv4 = hooked.createConversation('hooks', null)
await hooked.sendMessage(conv4.id, '跑一轮')

const findHook = (pred) => hookCalls.findIndex(pred)
const iConvCreated = findHook((c) => c[0] === 'onConversationCreated')
const iNodeRound = findHook((c) => c[0] === 'onNodeAdded' && c[1] === 'round' && c[2] === 'text')
const iTurnStart = findHook((c) => c[0] === 'onTurnStart')
const iToolStart = findHook((c) => c[0] === 'onToolStart')
const iToolEnd = findHook((c) => c[0] === 'onToolEnd')
const iRunEnd = findHook((c) => c[0] === 'onRunEnd')
assert.ok(iConvCreated === 0, 'onConversationCreated 最先触发')
assert.ok(iNodeRound > iConvCreated, 'onNodeAdded(round) 在 onConversationCreated 之后')
assert.ok(iTurnStart > iNodeRound, 'onTurnStart 在 onNodeAdded(round) 之后')
assert.ok(iToolStart > iTurnStart, 'onToolStart 在 onTurnStart 之后')
assert.ok(iToolEnd > iToolStart, 'onToolEnd 在 onToolStart 之后')
assert.deepEqual(hookCalls[iToolEnd], ['onToolEnd', 'bash', false], 'onToolEnd 带 isError=false')
assert.ok(iRunEnd > iToolEnd, 'onRunEnd 在工具执行完之后')
assert.deepEqual(hookCalls[iRunEnd], ['onRunEnd', 'done'], 'onRunEnd 带 reason=done')
assert.ok(!hookCalls.some((c) => c[0] === 'onError'), '正常流程不触发 onError')

/* ---- 场景 4b：钩子抛错不影响 loop ---- */
const throwing = new Harness({
  provider: new MockProvider({ charDelayMs: 1 }),
  model: 'mock-1',
  executor: async () => 'still-ok',
  hooks: {
    onTurnStart: () => {
      throw new Error('hook boom')
    },
    onToolEnd: () => {
      throw new Error('hook boom')
    },
    onRunEnd: () => {
      throw new Error('hook boom')
    },
  },
})
const conv5 = throwing.createConversation('throwing-hooks', null)
await throwing.sendMessage(conv5.id, '钩子炸了也要跑完')
const c5 = throwing.getConversation(conv5.id)
assert.equal(c5.status, 'done', '钩子抛错不影响 loop')
assert.ok(
  Object.values(c5.nodes).some((n) => n.blocks.some((b) => b.type === 'tool_result')),
  '工具仍正常执行',
)

/* ---- 场景 5：工具执行中途 abort → 孤儿 tool_use 在下轮回放时补占位 tool_result ---- */
{
  const captured = []
  const base = new MockProvider({ charDelayMs: 1 })
  const capProvider = {
    id: 'cap',
    streamChat(req) {
      captured.push(req.messages)
      return base.streamChat(req)
    },
  }
  // executor 挂起直到 abort：模拟"工具还没跑完用户就停了"
  const hangExecutor = (_n, _i, signal) =>
    new Promise((_, rej) => {
      if (signal.aborted) return rej(new Error('aborted'))
      signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
    })
  const h5 = new Harness({
    provider: capProvider,
    model: 'mock-1',
    tools: [{ name: 'bash', description: 'x', parameters: { type: 'object', properties: {} } }],
    executor: hangExecutor,
  })
  const convO = h5.createConversation('orphan', null)
  const p1 = h5.sendMessage(convO.id, '跑一下')
  await new Promise((r) => setTimeout(r, 200)) // 等工具开始执行
  h5.abort(convO.id)
  await p1
  const roundNode = Object.values(h5.getConversation(convO.id).nodes)[0]
  assert.ok(roundNode.blocks.some((b) => b.type === 'tool'), '有 tool 块')
  assert.ok(!roundNode.blocks.some((b) => b.type === 'tool_result'), '没有 tool_result（孤儿）')

  await h5.sendMessage(convO.id, '继续')
  const replayed = captured.at(-1)
  const toolUses = []
  const toolResults = new Set()
  for (const m of replayed) {
    for (const b of m.content) {
      if (b.type === 'tool_use') toolUses.push(b.id)
      if (b.type === 'tool_result') toolResults.add(b.toolUseId)
    }
  }
  assert.ok(toolUses.length > 0, '回放了 tool_use')
  assert.ok(
    toolUses.every((id) => toolResults.has(id)),
    '每个 tool_use 都有对应 tool_result（占位补齐）',
  )
}

console.log('smoke OK:', {
  scenario1: { events: events.length, nodes: nodes.length, executorCalls: executorCalls.length },
  scenario2: { status: c2.status },
  scenario3: { status: c3.status },
  scenario4: { hookCalls: hookCalls.length, throwingHooksStatus: c5.status },
})

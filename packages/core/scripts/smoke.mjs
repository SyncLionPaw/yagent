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
assert.equal(firstAdded.node.role, 'user', '首个节点是用户节点')
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

/* ---- 节点树结构：user → agent → user(tool_result) → agent ---- */
const c = harness.getConversation(conv.id)
const nodes = Object.values(c.nodes)
assert.equal(nodes.length, 4, '四个节点')
const root = nodes.find((n) => n.parentId === null)
assert.equal(root.role, 'user')
const agent1 = nodes.find((n) => n.parentId === root.id)
assert.equal(agent1.role, 'agent')
const toolResultNode = nodes.find((n) => n.parentId === agent1.id)
assert.equal(toolResultNode.role, 'user')
assert.equal(toolResultNode.blocks[0].type, 'tool_result')
assert.equal(toolResultNode.blocks[0].content, 'file1.ts\nfile2.ts')
const agent2 = nodes.find((n) => n.parentId === toolResultNode.id)
assert.equal(agent2.role, 'agent')
assert.equal(c.activeNodeId, agent2.id, 'activeNode 推进到最终 agent 节点')
assert.equal(c.status, 'done')

const thinkingBlock = agent1.blocks.find((b) => b.type === 'thinking')
assert.equal(thinkingBlock.status, 'done', 'thinking 块收尾为 done')
assert.ok(typeof thinkingBlock.durationMs === 'number', 'thinking 有耗时')
const toolBlock = agent1.blocks.find((b) => b.type === 'tool')
assert.equal(toolBlock.status, 'done')
assert.equal(toolBlock.summary, 'ls')
assert.ok(toolBlock.detail.includes('file1.ts'), 'tool detail 带 executor 输出')
assert.ok(toolBlock.toolUseId, 'tool 块带 toolUseId')
assert.ok(agent2.blocks.some((b) => b.type === 'text' && b.text.includes('MockProvider')), '收尾文本')
assert.ok(agent1.durationMs >= 0 && agent2.durationMs >= 0, 'agent 节点有 durationMs')

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
const resultNode3 = Object.values(c3.nodes).find((n) => n.role === 'user' && n.blocks[0]?.type === 'tool_result')
assert.equal(resultNode3.blocks[0].content, 'tool not available')
assert.equal(c3.status, 'done')

console.log('smoke OK:', {
  scenario1: { events: events.length, nodes: nodes.length, executorCalls: executorCalls.length },
  scenario2: { status: c2.status },
  scenario3: { status: c3.status },
})

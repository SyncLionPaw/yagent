// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { Harness } from '../src/harness/harness.js'
import type { HarnessEvent } from '../src/harness/events.js'
import type { ChatRequest, ModelProvider, StreamEvent, ToolDef } from '../src/providers/types.js'

function tool(name: string): ToolDef {
  return { name, description: `${name} tool`, parameters: { type: 'object' } }
}

function done(text: string): StreamEvent[] {
  return [{ type: 'text_delta', text }, { type: 'done', usage: { input: 1, output: 1 } }]
}

describe('Harness run configuration snapshots', () => {
  it('keeps provider, model, prompt, tools, executor and context limit stable across tool turns', async () => {
    const requestsA: ChatRequest[] = []
    const requestsB: ChatRequest[] = []
    const toolsA = [tool('tool_a')]
    const toolsB = [tool('tool_b')]
    let harness!: Harness

    const providerA: ModelProvider = {
      id: 'provider-a',
      async *streamChat(req) {
        requestsA.push(req)
        if (requestsA.length === 1) {
          yield { type: 'tool_use', id: 'call-a', name: 'tool_a', input: { value: 1 } }
        }
        yield* done('A finished')
      },
    }
    const providerB: ModelProvider = {
      id: 'provider-b',
      async *streamChat(req) {
        requestsB.push(req)
        yield* done('B finished')
      },
    }
    const executorA = vi.fn(async () => {
      harness.configure({
        provider: providerB,
        model: 'model-b',
        system: 'system-b',
        tools: toolsB,
        executor: executorB,
        contextLimit: 2_000,
      })
      return 'tool A result'
    })
    const executorB = vi.fn(async () => 'tool B result')

    harness = new Harness({
      provider: providerA,
      model: 'model-a',
      system: 'system-a',
      tools: toolsA,
      executor: executorA,
      contextLimit: 1_000,
    })
    const conv = harness.createConversation()
    const contextLimits: number[] = []
    harness.on((event: HarnessEvent) => {
      if (event.type === 'context_updated') contextLimits.push(event.snapshot.limit)
    })

    await harness.sendMessage(conv.id, 'first')

    expect(requestsA).toHaveLength(2)
    expect(requestsB).toHaveLength(0)
    for (const req of requestsA) {
      expect(req.model).toBe('model-a')
      expect(req.system).toBe('system-a')
      expect(req.tools).toBe(toolsA)
    }
    expect(executorA).toHaveBeenCalledOnce()
    expect(executorB).not.toHaveBeenCalled()
    expect(contextLimits.length).toBeGreaterThan(0)
    expect(contextLimits).toEqual(contextLimits.map(() => 1_000))

    await harness.sendMessage(conv.id, 'second')
    expect(requestsA).toHaveLength(2)
    expect(requestsB).toHaveLength(1)
    expect(requestsB[0]!.model).toBe('model-b')
    expect(requestsB[0]!.system).toBe('system-b')
    expect(requestsB[0]!.tools).toBe(toolsB)
    expect(contextLimits.at(-1)).toBe(2_000)
  })

  it('drains a queued message with the configuration captured when it was queued', async () => {
    const requestsA: ChatRequest[] = []
    const requestsB: ChatRequest[] = []
    let releaseSecond!: () => void
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const providerA: ModelProvider = {
      id: 'provider-a',
      async *streamChat(req) {
        requestsA.push(req)
        if (requestsA.length === 2) await secondGate
        yield* done(`A response ${requestsA.length}`)
      },
    }
    const providerB: ModelProvider = {
      id: 'provider-b',
      async *streamChat(req) {
        requestsB.push(req)
        yield* done('B response')
      },
    }
    const harness = new Harness({ provider: providerA, model: 'model-a', system: 'system-a' })
    const conv = harness.createConversation()

    await harness.sendMessage(conv.id, 'first')
    const running = harness.sendMessage(conv.id, 'second')
    await vi.waitFor(() => expect(requestsA).toHaveLength(2))

    await harness.sendMessage(conv.id, 'queued while A is running')
    expect(harness.pendingCount(conv.id)).toBe(1)
    harness.configure({ provider: providerB, model: 'model-b', system: 'system-b' })
    releaseSecond()
    await running

    await vi.waitFor(() => expect(requestsA).toHaveLength(3))
    expect(requestsB).toHaveLength(0)
    expect(requestsA[2]!.model).toBe('model-a')
    expect(requestsA[2]!.system).toBe('system-a')
    expect(harness.pendingCount(conv.id)).toBe(0)
  })
})

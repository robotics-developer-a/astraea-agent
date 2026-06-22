import { test, expect } from 'bun:test'
import { withIdleWatchdog, linkAbort, mapAnthropicMessageToEvents, mapOpenAICompletionToEvents } from './idleWatchdog'
import type { StreamEvent } from '../types/message'
import type { Message as SDKMessage } from '@anthropic-ai/sdk/resources/messages'
import type OpenAI from 'openai'

// 把若干事件做成一个「正常」流式生成器。
async function* normalStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of events) yield e
}

// 模拟「连接被悄悄掐断」：吐完 before 后永远挂起，直到 signal abort 才抛 AbortError。
function stalledStream(before: StreamEvent[], signal: AbortSignal) {
  return (async function* (): AsyncGenerator<StreamEvent> {
    for (const e of before) yield e
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
  })()
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

test('正常流：事件原样透传，abort/fallback 不被调用', async () => {
  const events: StreamEvent[] = [
    { type: 'text', text: 'hello' },
    { type: 'message_stop', usage: { input_tokens: 1, output_tokens: 1 }, stopReason: 'end_turn' },
  ]
  let aborted = false
  let fellBack = false
  const out = await collect(withIdleWatchdog({
    stream: normalStream(events),
    abort: () => { aborted = true },
    fallback: () => { fellBack = true; return [] },
    idleMs: 1000,
  }))
  expect(out).toEqual(events)
  expect(aborted).toBe(false)
  expect(fellBack).toBe(false)
})

test('卡死流：超时后 abort 一次并吐出 fallback 事件', async () => {
  const linked = linkAbort()
  let abortCalls = 0
  const fallbackEvents: StreamEvent[] = [
    { type: 'text', text: 'from-fallback' },
    { type: 'message_stop', usage: { input_tokens: 2, output_tokens: 3 }, stopReason: 'end_turn' },
  ]
  const out = await collect(withIdleWatchdog({
    stream: stalledStream([{ type: 'text', text: 'partial' }], linked.signal),
    abort: () => { abortCalls++; linked.abort() },
    fallback: async () => fallbackEvents,
    idleMs: 30,
  }))
  // 卡死前的 partial 已透传，随后是 fallback 的完整事件序列
  expect(out).toEqual([{ type: 'text', text: 'partial' }, ...fallbackEvents])
  expect(abortCalls).toBe(1)
})

test('首个 chunk 就卡死：直接走 fallback', async () => {
  const linked = linkAbort()
  const fallbackEvents: StreamEvent[] = [{ type: 'text', text: 'recovered' }]
  const out = await collect(withIdleWatchdog({
    stream: stalledStream([], linked.signal),
    abort: () => linked.abort(),
    fallback: async () => fallbackEvents,
    idleMs: 30,
  }))
  expect(out).toEqual(fallbackEvents)
})

test('外部 abort：透出 AbortError，fallback 不被调用', async () => {
  const external = new AbortController()
  const linked = linkAbort(external.signal)
  let fellBack = false
  const gen = withIdleWatchdog({
    stream: stalledStream([{ type: 'text', text: 'x' }], linked.signal),
    abort: () => linked.abort(),
    fallback: () => { fellBack = true; return [] },
    idleMs: 10_000, // 远大于外部 abort 触发时机，确保不是看门狗先动手
  })
  // 拿到第一个事件后外部中止
  const it = gen[Symbol.asyncIterator]()
  const first = await it.next()
  expect(first.value).toEqual({ type: 'text', text: 'x' })
  external.abort()
  await expect(it.next()).rejects.toThrow(/abort/i)
  expect(fellBack).toBe(false)
})

test('fallback 自身抛错：错误向上传播，不二次兜底', async () => {
  const linked = linkAbort()
  const gen = withIdleWatchdog({
    stream: stalledStream([], linked.signal),
    abort: () => linked.abort(),
    fallback: async () => { throw new Error('fallback boom') },
    idleMs: 30,
  })
  await expect(collect(gen)).rejects.toThrow('fallback boom')
})

test('linkAbort：外部已 aborted 时内部 signal 立即 aborted', () => {
  const external = new AbortController()
  external.abort()
  const linked = linkAbort(external.signal)
  expect(linked.signal.aborted).toBe(true)
})

test('mapAnthropicMessageToEvents：text + tool_use + message_stop', () => {
  const msg = {
    content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a' } },
    ],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    stop_reason: 'tool_use',
  } as unknown as SDKMessage
  const events = mapAnthropicMessageToEvents(msg)
  expect(events).toEqual([
    { type: 'text', text: 'hi' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a' }, incomplete: false },
    {
      type: 'message_stop',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
      stopReason: 'tool_use',
    },
  ])
})

test('mapOpenAICompletionToEvents：content + tool_calls，arguments 解析', () => {
  const resp = {
    choices: [{
      message: {
        content: 'answer',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Bash', arguments: '{"cmd":"ls"}' } }],
      },
      finish_reason: 'tool_calls',
    }],
  } as unknown as OpenAI.Chat.ChatCompletion
  const events = mapOpenAICompletionToEvents(resp, { input_tokens: 7, output_tokens: 4, cache_read_input_tokens: 1 })
  expect(events).toEqual([
    { type: 'text', text: 'answer' },
    { type: 'tool_use', id: 'c1', name: 'Bash', input: { cmd: 'ls' }, incomplete: false },
    { type: 'message_stop', usage: { input_tokens: 7, output_tokens: 4, cache_read_input_tokens: 1 }, stopReason: 'tool_use' },
  ])
})

test('mapOpenAICompletionToEvents：arguments 非法 JSON → incomplete', () => {
  const resp = {
    choices: [{
      message: { content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'X', arguments: '{bad' } }] },
      finish_reason: 'tool_calls',
    }],
  } as unknown as OpenAI.Chat.ChatCompletion
  const events = mapOpenAICompletionToEvents(resp, { input_tokens: 0, output_tokens: 0 })
  expect(events[0]).toEqual({ type: 'tool_use', id: 'c2', name: 'X', input: {}, incomplete: true })
})

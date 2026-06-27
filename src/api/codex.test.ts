import { test, expect, afterEach } from 'bun:test'
import { convertMessagesToInput, convertTools, parseCodexSSE, buildReasoningParam, buildCodexRequestBody } from './codex'
import { setSessionEffort, unsetSessionEffort } from '../state/reasoningEffort'
import type { Message, StreamEvent } from '../types/message'
import type { ToolSchema } from '../tools/Tool'

// ─── 消息 → Responses input 转换 ─────────────────────────────────────────────

test('user string → message item with input_text', () => {
  const msgs: Message[] = [{ role: 'user', content: 'hello' }]
  expect(convertMessagesToInput(msgs)).toEqual([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
  ])
})

test('assistant text + tool_use, then user tool_result round-trip', () => {
  const msgs: Message[] = [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'reading file' },
        { type: 'tool_use', id: 'call_1', name: 'read', input: { path: 'a.ts' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }],
    },
  ]
  expect(convertMessagesToInput(msgs)).toEqual([
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reading file' }] },
    { type: 'function_call', call_id: 'call_1', name: 'read', arguments: JSON.stringify({ path: 'a.ts' }) },
    { type: 'function_call_output', call_id: 'call_1', output: 'file body' },
  ])
})

test('empty assistant text blocks are skipped', () => {
  const msgs: Message[] = [{ role: 'assistant', content: [{ type: 'text', text: '' }] }]
  expect(convertMessagesToInput(msgs)).toEqual([])
})

test('convertTools is flat (name/description/parameters at top level)', () => {
  const tools: ToolSchema[] = [
    { name: 'read', description: 'read a file', input_schema: { type: 'object', properties: {} } },
  ]
  expect(convertTools(tools)).toEqual([
    { type: 'function', name: 'read', description: 'read a file', parameters: { type: 'object', properties: {} } },
  ])
  expect(convertTools(undefined)).toBeUndefined()
  expect(convertTools([])).toBeUndefined()
})

test('buildCodexRequestBody sends the configured max output token cap', () => {
  const body = buildCodexRequestBody(
    [{ role: 'user', content: 'hello' }],
    { model: 'gpt-5.4-mini', maxTokens: 4096 },
  )

  expect(body.max_output_tokens).toBe(4096)
})

// ─── SSE 解析 ────────────────────────────────────────────────────────────────

// 把 SSE 文本包成 ReadableStream（可分片以验证跨 chunk 缓冲）。
function sseStream(text: string, chunkSize = 9999): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

async function collect(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

test('parseCodexSSE streams text deltas and a final message_stop with usage', async () => {
  const fixture = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"Hello"}',
    '',
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":" world"}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":3,"input_tokens_details":{"cached_tokens":4}}}}',
    '',
  ].join('\n')

  const events = await collect(parseCodexSSE(sseStream(fixture)))
  expect(events).toEqual([
    { type: 'text', text: 'Hello' },
    { type: 'text', text: ' world' },
    {
      type: 'message_stop',
      usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4 },
      stopReason: 'end_turn',
    },
  ])
})

test('parseCodexSSE accumulates function_call arguments and emits tool_use', async () => {
  const fixture = [
    'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_9","name":"read"}}',
    '',
    'data: {"type":"response.function_call_arguments.delta","call_id":"call_9","delta":"{\\"path\\":"}',
    '',
    'data: {"type":"response.function_call_arguments.delta","call_id":"call_9","delta":"\\"a.ts\\"}"}',
    '',
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_9","name":"read"}}',
    '',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
  ].join('\n')

  const events = await collect(parseCodexSSE(sseStream(fixture)))
  expect(events[0]).toEqual({
    type: 'tool_use', id: 'call_9', name: 'read', input: { path: 'a.ts' }, incomplete: false,
  })
  const stop = events[1] as Extract<StreamEvent, { type: 'message_stop' }>
  expect(stop.type).toBe('message_stop')
  expect(stop.stopReason).toBe('tool_use')
})

test('parseCodexSSE survives event boundaries split across read chunks', async () => {
  const fixture = [
    'data: {"type":"response.output_text.delta","delta":"chunked"}',
    '',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0}}}',
    '',
  ].join('\n')
  // 每次只吐 5 字节，强制事件被切碎、跨 chunk 重组。
  const events = await collect(parseCodexSSE(sseStream(fixture, 5)))
  expect(events[0]).toEqual({ type: 'text', text: 'chunked' })
})

test('parseCodexSSE maps response.incomplete (max_output_tokens) to max_tokens stop', async () => {
  const fixture = [
    'data: {"type":"response.incomplete","response":{"usage":{"input_tokens":5,"output_tokens":7},"incomplete_details":{"reason":"max_output_tokens"}}}',
    '',
  ].join('\n')
  const events = await collect(parseCodexSSE(sseStream(fixture)))
  const stop = events[0] as Extract<StreamEvent, { type: 'message_stop' }>
  expect(stop.stopReason).toBe('max_tokens')
})

test('parseCodexSSE maps reasoning summary + text deltas to thinking events', async () => {
  const fixture = [
    'data: {"type":"response.reasoning_summary_text.delta","delta":"plan: "}',
    '',
    'data: {"type":"response.reasoning_text.delta","delta":"step 1"}',
    '',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0}}}',
    '',
  ].join('\n')
  const events = await collect(parseCodexSSE(sseStream(fixture)))
  expect(events[0]).toEqual({ type: 'thinking', text: 'plan: ' })
  expect(events[1]).toEqual({ type: 'thinking', text: 'step 1' })
})

test('parseCodexSSE flags a tool_use as incomplete when arguments are malformed JSON', async () => {
  const fixture = [
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"edit","arguments":"{bad json"}}',
    '',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
  ].join('\n')
  const events = await collect(parseCodexSSE(sseStream(fixture)))
  expect(events[0]).toEqual({ type: 'tool_use', id: 'c1', name: 'edit', input: {}, incomplete: true })
})

test('parseCodexSSE emits one tool_use per parallel function_call', async () => {
  const fixture = [
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"read","arguments":"{\\"p\\":\\"a\\"}"}}',
    '',
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c2","name":"read","arguments":"{\\"p\\":\\"b\\"}"}}',
    '',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
  ].join('\n')
  const events = await collect(parseCodexSSE(sseStream(fixture)))
  const toolUses = events.filter((e) => e.type === 'tool_use')
  expect(toolUses).toHaveLength(2)
  expect((toolUses[0] as Extract<StreamEvent, { type: 'tool_use' }>).input).toEqual({ p: 'a' })
  expect((toolUses[1] as Extract<StreamEvent, { type: 'tool_use' }>).input).toEqual({ p: 'b' })
})

test('parseCodexSSE still emits message_stop (end_turn) when the stream closes with no completed event', async () => {
  const fixture = ['data: {"type":"response.output_text.delta","delta":"hi"}', ''].join('\n')
  const events = await collect(parseCodexSSE(sseStream(fixture)))
  expect(events[0]).toEqual({ type: 'text', text: 'hi' })
  const stop = events.at(-1) as Extract<StreamEvent, { type: 'message_stop' }>
  expect(stop.type).toBe('message_stop')
  expect(stop.stopReason).toBe('end_turn')
  expect(stop.usage).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 })
})

test('parseCodexSSE throws on a response.failed event', async () => {
  const fixture = ['data: {"type":"response.failed","response":{"error":{"message":"boom"}}}', ''].join('\n')
  await expect(collect(parseCodexSSE(sseStream(fixture)))).rejects.toThrow(/boom/)
})

// ─── 更多消息转换 ────────────────────────────────────────────────────────────

test('tool_result with array content concatenates the text blocks', () => {
  const msgs: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar' }] },
      ],
    },
  ]
  expect(convertMessagesToInput(msgs)).toEqual([
    { type: 'function_call_output', call_id: 'c1', output: 'foobar' },
  ])
})

test('a plain text block inside a user array becomes an input_text message', () => {
  const msgs: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi there' }] }]
  expect(convertMessagesToInput(msgs)).toEqual([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi there' }] },
  ])
})

test('an assistant message with only a tool_use (no text) converts to a single function_call', () => {
  const msgs: Message[] = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c9', name: 'ls', input: {} }] },
  ]
  expect(convertMessagesToInput(msgs)).toEqual([
    { type: 'function_call', call_id: 'c9', name: 'ls', arguments: '{}' },
  ])
})

// ─── reasoning 参数映射 ──────────────────────────────────────────────────────

const savedEffortEnv = process.env.ASTRAEA_REASONING_EFFORT
afterEach(() => {
  unsetSessionEffort()
  if (savedEffortEnv === undefined) delete process.env.ASTRAEA_REASONING_EFFORT
  else process.env.ASTRAEA_REASONING_EFFORT = savedEffortEnv
})

test('buildReasoningParam downgrades max → high for a gpt-5 model', () => {
  delete process.env.ASTRAEA_REASONING_EFFORT
  setSessionEffort('max')
  expect(buildReasoningParam('gpt-5.4')).toEqual({ effort: 'high', summary: 'auto' })
})

test('buildReasoningParam passes low/medium/high through unchanged', () => {
  delete process.env.ASTRAEA_REASONING_EFFORT
  setSessionEffort('low')
  expect(buildReasoningParam('gpt-5.5')).toEqual({ effort: 'low', summary: 'auto' })
})

test('buildReasoningParam returns undefined for a non-reasoning model', () => {
  delete process.env.ASTRAEA_REASONING_EFFORT
  setSessionEffort('high')
  expect(buildReasoningParam('gpt-4o')).toBeUndefined()
})

test('buildReasoningParam returns undefined when no effort is set (auto)', () => {
  delete process.env.ASTRAEA_REASONING_EFFORT
  unsetSessionEffort()
  expect(buildReasoningParam('gpt-5.4')).toBeUndefined()
})

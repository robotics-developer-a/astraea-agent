// 方案 C / §5-#11: 压缩对超大 tool_result 的防御性截断
import { test, expect } from 'bun:test'
import { truncateOversizedToolResults, selectRecentMessages } from './compact'
import type { UserMessage, AssistantMessage } from '../../types/message'

type Conv = UserMessage | AssistantMessage
const blocks = (m: Conv) => (typeof m.content === 'string' ? [] : m.content) as any[]

test('超预算的 tool_result 被占位符替换，小的保留', () => {
  const big = 'x'.repeat(40_000) // ~10000 token
  const msgs: UserMessage[] = [{
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'a', content: big },
      { type: 'tool_result', tool_use_id: 'b', content: 'small result' },
    ],
  }]
  const out = truncateOversizedToolResults(msgs, 1_000)
  const bs = blocks(out[0]!)
  expect(bs[0].content).toContain('omitted by compaction')
  expect(bs[0].content).not.toContain('x'.repeat(100)) // 原文不再泄漏
  expect(bs[0].tool_use_id).toBe('a')                  // 保留 id，不破坏 API 契约
  expect(bs[1].content).toBe('small result')           // 未超预算的原样保留
})

test('§5-#11: 占位符不含「on disk」假承诺', () => {
  const out = truncateOversizedToolResults(
    [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'y'.repeat(40_000) }] }],
    1_000,
  )
  expect(blocks(out[0]!)[0].content.toLowerCase()).not.toContain('on disk')
})

test('非 tool_result 内容原样保留', () => {
  const msgs: UserMessage[] = [{ role: 'user', content: 'just text' }]
  expect(truncateOversizedToolResults(msgs, 10)).toEqual(msgs)
})

test('§2.3 兜底：最近 turn 的超大 tool_result 经 selectRecentMessages 被截断', () => {
  const poison = 'z'.repeat(400_000) // ~100000 token，远超落点预算
  const msgs: Conv[] = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: poison }] },
    { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
  ]
  const out = selectRecentMessages(msgs, 2_000)
  const tr = out.flatMap(blocks).find(b => b.type === 'tool_result')
  expect(tr.content).toContain('omitted by compaction')
})

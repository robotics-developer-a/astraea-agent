import { test, expect, beforeEach } from 'bun:test'
import {
  effectiveWindow,
  thresholds,
  percentLeft,
  landingTarget,
} from './window'
import { extractSummary } from './compactPrompt'
import {
  estimateTokens,
  truncateHeadForPTLRetry,
  selectRecentMessages,
  buildPostCompactMessages,
  isOverflowError,
} from './compact'
import type { UserMessage, AssistantMessage } from '../../types/message'
import {
  resetContextTokens,
  recordCompactionFailure,
  recordCompactionResult,
  isCompactionTripped,
  recordInputTokens,
  getInputTokens,
  markTokensUnknown,
} from '../../state/contextTokens'

// ── window/阈值（设计文档 §2/§3/§4 的数值表）────────────────────────────────
test('effectiveWindow: anthropic 200K/32K → 166K，ollama 32K/8K → 21808', () => {
  expect(effectiveWindow(200_000, 32_000)).toBe(166_000)
  expect(effectiveWindow(32_000, 8_192)).toBe(21_808)
})

test('effectiveWindow: cap 在窗口一半，防小窗口被压到 0', () => {
  // maxOutput 远大于窗口一半时，预留量被 cap 在 ctx*0.5
  expect(effectiveWindow(8_000, 8_000)).toBe(4_000) // reserved = min(10000, 4000) = 4000
})

test('thresholds: 0.80/0.92/0.98 与文档数值一致', () => {
  const t = thresholds(166_000)
  expect(t.warning).toBe(132_800)
  expect(t.autocompact).toBe(152_720)
  expect(t.blocking).toBe(162_680)
})

test('percentLeft 相对 autocompact 阈值', () => {
  expect(percentLeft(76_360, 152_720)).toBe(50)
  expect(percentLeft(152_720, 152_720)).toBe(0)
  expect(percentLeft(200_000, 152_720)).toBe(0) // clamp 不为负
})

test('landingTarget = eff × 0.35', () => {
  // floor(166000 * 0.35) = 58099（浮点 58099.999… 向下取整）
  expect(landingTarget(166_000)).toBe(58_099)
})

// ── extractSummary：剥 <analysis>，提取 <summary>（设计文档 §5.2）────────────
test('extractSummary 剥掉 analysis 只留 summary', () => {
  expect(extractSummary('<analysis>thinking</analysis><summary>result</summary>')).toBe('result')
})

test('extractSummary 多行 summary', () => {
  expect(extractSummary('<summary>line1\nline2</summary>')).toBe('line1\nline2')
})

test('extractSummary 无标签 → 返回 trim 后全文', () => {
  expect(extractSummary('  just text  ')).toBe('just text')
})

test('extractSummary 未闭合 summary（被截断）→ 取 summary 之后全部', () => {
  expect(extractSummary('<analysis>a</analysis><summary>partial output')).toBe('partial output')
})

// ── estimateTokens / 截头 / sanitize / 重建 ─────────────────────────────────
test('estimateTokens ≈ chars/4', () => {
  const msgs: UserMessage[] = [{ role: 'user', content: 'a'.repeat(400) }]
  expect(estimateTokens(msgs)).toBe(100)
})

test('truncateHeadForPTLRetry 砍头并加 marker；二次调用剥旧 marker 再砍', () => {
  const msgs: (UserMessage | AssistantMessage)[] = Array.from({ length: 9 }, (_, i) => ({
    role: 'user' as const,
    content: `m${i}`,
  }))
  const once = truncateHeadForPTLRetry(msgs)
  expect(once[0]!.role).toBe('user')
  expect(typeof once[0]!.content === 'object' && once[0]!.content[0]).toMatchObject({ type: 'text' })
  // 砍掉前 max(2, floor(9/3))=3 条 → marker + 6 条
  expect(once.length).toBe(7)
  const twice = truncateHeadForPTLRetry(once)
  // 剥掉旧 marker（剩 6）再砍 max(2, floor(6/3))=2 → marker + 4
  expect(twice.length).toBe(5)
})

test('selectRecentMessages 去掉孤儿 tool_result（其 tool_use 不在切片内）', () => {
  const msgs: (UserMessage | AssistantMessage)[] = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    { role: 'user', content: 'thanks' },
  ]
  // 预算足够大 → 全保留，t1 配对在切片内 → 不被删
  const all = selectRecentMessages(msgs, 1_000_000)
  expect(all.length).toBe(4)
})

test('selectRecentMessages 切片起点是孤儿 tool_result → 被过滤', () => {
  const msgs: (UserMessage | AssistantMessage)[] = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'A'.repeat(4000) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'B'.repeat(4000) }] },
    { role: 'user', content: 'C'.repeat(4000) },
    { role: 'assistant', content: [{ type: 'text', text: 'D' }] },
  ]
  // 小预算 → 只保尾部；若切片从孤儿 tool_result(t1，但 t1 的 tool_use 被切掉)开始，该条被过滤
  const recent = selectRecentMessages(msgs, 100)
  for (const m of recent) {
    if (m.role === 'user' && typeof m.content !== 'string') {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          // 任何保留下来的 tool_result，其 tool_use 必须也在切片内
          const hasOwner = recent.some(
            x => x.role === 'assistant' && typeof x.content !== 'string' &&
              x.content.some(y => y.type === 'tool_use' && y.id === b.tool_use_id),
          )
          expect(hasOwner).toBe(true)
        }
      }
    }
  }
})

test('buildPostCompactMessages：摘要作首条 user 消息带标签', () => {
  const recent: AssistantMessage[] = [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }]
  const out = buildPostCompactMessages('THE SUMMARY', recent)
  expect(out[0]!.role).toBe('user')
  expect(typeof out[0]!.content).toBe('string')
  expect(out[0]!.content as string).toContain('<conversation_summary>')
  expect(out[0]!.content as string).toContain('THE SUMMARY')
  expect(out.length).toBe(2)
})

// ── 溢出错误归一（设计文档 §8）──────────────────────────────────────────────
test('isOverflowError 识别各家溢出', () => {
  expect(isOverflowError(new Error('prompt is too long: 250000 tokens'))).toBe(true)
  expect(isOverflowError(new Error('Request failed with status 413'))).toBe(true)
  expect(isOverflowError(new Error('context_length_exceeded'))).toBe(true)
  expect(isOverflowError(new Error('maximum context length is 128000'))).toBe(true)
  expect(isOverflowError(new Error('rate limit exceeded'))).toBe(false)
  expect(isOverflowError(new Error('connection reset'))).toBe(false)
})

// ── 双触发熔断（设计文档 §8）────────────────────────────────────────────────
beforeEach(() => resetContextTokens())

test('连续 3 次硬失败 → 跳闸', () => {
  recordCompactionFailure()
  recordCompactionFailure()
  expect(isCompactionTripped()).toBe(false)
  recordCompactionFailure()
  expect(isCompactionTripped()).toBe(true)
})

test('连续 3 次 willRetrigger → 跳闸', () => {
  recordCompactionResult(true)
  recordCompactionResult(true)
  expect(isCompactionTripped()).toBe(false)
  recordCompactionResult(true)
  expect(isCompactionTripped()).toBe(true)
})

test('干净压缩（未 retrigger）清零 willRetrigger 连击', () => {
  recordCompactionResult(true)
  recordCompactionResult(true)
  recordCompactionResult(false) // 清零
  recordCompactionResult(true)
  recordCompactionResult(true)
  expect(isCompactionTripped()).toBe(false) // 只连了 2 次
})

test('成功清零硬失败连击', () => {
  recordCompactionFailure()
  recordCompactionFailure()
  recordCompactionResult(false) // 成功 → 清零 hardFailures
  recordCompactionFailure()
  recordCompactionFailure()
  expect(isCompactionTripped()).toBe(false) // 只连了 2 次
})

test('token 计数：record / unknown', () => {
  expect(getInputTokens()).toBe(null)
  recordInputTokens(1234)
  expect(getInputTokens()).toBe(1234)
  markTokensUnknown()
  expect(getInputTokens()).toBe(null)
})

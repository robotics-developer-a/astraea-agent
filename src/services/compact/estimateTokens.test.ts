// §5-#1: estimateTokens 必须 CJK 感知 —— chars/4 对中文严重低估
import { test, expect } from 'bun:test'
import { estimateTextTokens, estimateTokens } from './compact'
import type { UserMessage } from '../../types/message'

test('estimateTextTokens: ASCII 维持 chars/4 口径', () => {
  expect(estimateTextTokens('a'.repeat(400))).toBe(100)
})

test('estimateTextTokens: 中文按 ~1.5 token/字（远高于 chars/4 的 0.25）', () => {
  // 100 个中文字：chars/4 会给 25，真实应 ≈ 150
  expect(estimateTextTokens('中'.repeat(100))).toBe(150)
})

test('estimateTextTokens: 中英混排分别计权后相加', () => {
  // 100 中文(150) + 400 ASCII(100) = 250
  expect(estimateTextTokens('中'.repeat(100) + 'a'.repeat(400))).toBe(250)
})

test('estimateTextTokens: 全角标点也算 CJK', () => {
  // 「，」U+FF0C 落在全角区，按 CJK 计权
  expect(estimateTextTokens('，'.repeat(10))).toBe(15)
})

test('estimateTokens: 消息级中文不再被低估 4~6 倍', () => {
  const msgs: UserMessage[] = [{ role: 'user', content: '数'.repeat(100) }]
  expect(estimateTokens(msgs)).toBe(150)
})

test('estimateTokens: 纯 ASCII 回归（与旧 chars/4 一致）', () => {
  const msgs: UserMessage[] = [{ role: 'user', content: 'a'.repeat(400) }]
  expect(estimateTokens(msgs)).toBe(100)
})

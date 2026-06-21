// 验证 Bash 工具对「发给模型的 output」做字符截断（防上下文爆炸）。
import { test, expect } from 'bun:test'
import { truncateForModel } from './index'

test('超限 → 截断并带头尾 + 省略标注', () => {
  const big = Array.from({ length: 60_000 }, (_, i) => i + 1).join('\n')
  const out = truncateForModel(big, 30_000)
  // 截断后长度 ≈ 上限 + 标注开销，应远小于原文
  expect(out.length).toBeLessThan(31_000)
  expect(out.length).toBeLessThan(big.length)
  expect(out).toContain('characters truncated')
  // 头尾都保留：开头是 1、结尾是 60000
  expect(out.startsWith('1')).toBe(true)
  expect(out.trimEnd().endsWith('60000')).toBe(true)
})

test('未超限 → 原样返回，不加标注', () => {
  const small = 'hello\nworld'
  const out = truncateForModel(small, 30_000)
  expect(out).toBe(small)
  expect(out).not.toContain('characters truncated')
})

test('省略字符数正确', () => {
  const text = 'a'.repeat(1000)
  const out = truncateForModel(text, 100)
  // headLen=70, tailLen=30, omitted=900
  expect(out).toContain('[900 characters truncated')
})

// 锁定流式预览的宽度截断 —— 这是 Windows「✦ Astraea 重影堆叠」修复的核心：
// 任何一行的显示宽度都必须严格小于列数，终端才不会折行、Ink 擦除才数得准。

import { test, expect } from 'bun:test'
import stripAnsi from 'strip-ansi'
import { renderMarkdown } from './markdown'
import { charDisplayWidth, stringDisplayWidth, clampLineWidth, safeWinPreview, safeAnsiPreview } from './termWidth'

test('charDisplayWidth：CJK/全角=2，ASCII=1', () => {
  expect(charDisplayWidth('a'.codePointAt(0)!)).toBe(1)
  expect(charDisplayWidth('中'.codePointAt(0)!)).toBe(2)
  expect(charDisplayWidth('星'.codePointAt(0)!)).toBe(2)
})

test('clampLineWidth：ASCII 行超长时截断且严格小于列宽', () => {
  const out = clampLineWidth('a'.repeat(100), 20)
  expect(stringDisplayWidth(out)).toBeLessThan(20)
  expect(out.endsWith('…')).toBe(true)
})

test('clampLineWidth：中文行（每字宽 2）也严格不超宽', () => {
  const out = clampLineWidth('解决问题'.repeat(30), 20)
  expect(stringDisplayWidth(out)).toBeLessThan(20)
})

test('clampLineWidth：未超长则原样返回', () => {
  expect(clampLineWidth('hello', 40)).toBe('hello')
})

test('safeWinPreview：每一行都严格小于列宽，且只保留尾部若干行', () => {
  const cols = 30
  const maxLines = 5
  const text = Array.from({ length: 20 }, (_, i) => `第${i}行 ` + '内容'.repeat(40)).join('\n')
  const preview = safeWinPreview(text, cols, maxLines)
  const lines = preview.split('\n')
  // 尾部 maxLines 行 + 1 行省略标记
  expect(lines.length).toBeLessThanOrEqual(maxLines + 1)
  for (const l of lines) {
    expect(stringDisplayWidth(l)).toBeLessThan(cols)
  }
})

test('safeAnsiPreview：保留 markdown 样式但按可见宽度安全截断', () => {
  const cols = 24
  const rendered = renderMarkdown('**重点**：请运行 `bun test` 验证。' + '内容'.repeat(20))
  const preview = safeAnsiPreview(rendered, cols, 4)

  expect(preview).not.toBe(stripAnsi(preview))
  expect(stripAnsi(preview)).toContain('重点')
  expect(stripAnsi(preview)).not.toContain('**重点**')
  for (const line of preview.split('\n')) {
    expect(stringDisplayWidth(line)).toBeLessThan(cols)
  }
})

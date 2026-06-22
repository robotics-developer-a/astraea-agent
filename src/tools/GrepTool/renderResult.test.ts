// GrepTool.renderResult — 单行摘要回归测试。
// 按三种 output 模式给出单行摘要,而不是把整段匹配铺满屏幕。
import { test, expect } from 'bun:test'
import { GrepTool } from './index'

const render = (input: Record<string, unknown>, output: string, isError = false) =>
  GrepTool.renderResult?.({ pattern: 'x', ...input }, output, isError) ?? null

test('files_with_matches（默认）→ Found N files', () => {
  const output = 'src/a.ts\nsrc/b.ts'
  expect(render({}, output)).toEqual(['Found 2 files'])
})

test('content 模式 → Found N matches', () => {
  const output = 'src/a.ts:12:  const x = 1\nsrc/a.ts:30:  const x = 2\nsrc/b.ts:5:  const x = 3'
  expect(render({ output: 'content' }, output)).toEqual(['Found 3 matches'])
})

test('count 模式 → Found N files', () => {
  const output = 'src/a.ts:4\nsrc/b.ts:1'
  expect(render({ output: 'count' }, output)).toEqual(['Found 2 files'])
})

test('无匹配 → No matches found', () => {
  expect(render({}, 'No matches found for: xyz')).toEqual(['No matches found'])
})

test('截断 → 不计 (truncated...) 行,带 (truncated) 后缀', () => {
  const output = 'src/a.ts\nsrc/b.ts\n(truncated at 250 results)'
  expect(render({}, output)).toEqual(['Found 2 files (truncated)'])
})

test('出错 → null（让上层铺全错误）', () => {
  expect(render({}, 'ripgrep not found: boom', true)).toBeNull()
})

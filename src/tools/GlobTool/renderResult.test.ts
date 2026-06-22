// GlobTool.renderResult — 单行摘要回归测试。
// 让读类工具默认只出一行 "Found N files",而不是把整段文件列表铺满屏幕。
import { test, expect } from 'bun:test'
import { GlobTool } from './index'

const render = (output: string, isError = false) =>
  GlobTool.renderResult?.({ pattern: '**/*.ts' }, output, isError) ?? null

test('多个匹配 → 单行 Found N files', () => {
  const output = 'src/a.ts\nsrc/b.ts\nsrc/c.ts\n\n3 files found in 5ms'
  expect(render(output)).toEqual(['Found 3 files'])
})

test('单个匹配 → Found 1 files（克制,不做单复数）', () => {
  const output = 'src/a.ts\n\n1 file found in 2ms'
  expect(render(output)).toEqual(['Found 1 files'])
})

test('零匹配 → Found 0 files', () => {
  expect(render('No files found')).toEqual(['Found 0 files'])
})

test('零匹配带 Hint → 仍 Found 0 files', () => {
  expect(render('No files found\nHint: try a broader pattern')).toEqual(['Found 0 files'])
})

test('截断 → Found N files (truncated)', () => {
  const output = 'a.ts\nb.ts\n(Results are truncated. Consider using a more specific path or pattern.)\n\n100 files found in 9ms (truncated)'
  expect(render(output)).toEqual(['Found 100 files (truncated)'])
})

test('出错 → null（让上层铺全错误）', () => {
  expect(render('Glob error: boom', true)).toBeNull()
})

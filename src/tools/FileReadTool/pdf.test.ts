// 方案 B / §5-#10: PDF 抽取的纯函数 + 真实 unpdf 集成
import { test, expect } from 'bun:test'
import { parsePagesParam, formatPdfOutput, extractPdfText, PDF_MAX_PAGES_PER_READ } from './pdf'
import { buildTestPdf } from './buildTestPdf'

// ── parsePagesParam（含 §5-#10 边界）──────────────────────────────────────
test('parsePagesParam: 不传 → 默认第 1 页起、上限 20 页', () => {
  expect(parsePagesParam(undefined, 5)).toEqual({ pages: [1, 2, 3, 4, 5] })
  expect(parsePagesParam(undefined, 50)).toEqual({ pages: Array.from({ length: 20 }, (_, i) => i + 1) })
})

test('parsePagesParam: 单页与范围', () => {
  expect(parsePagesParam('3', 5)).toEqual({ pages: [3] })
  expect(parsePagesParam('2-4', 5)).toEqual({ pages: [2, 3, 4] })
})

test('parsePagesParam: 超过 20 页/读 → 拒绝', () => {
  const r = parsePagesParam('1-30', 100)
  expect('error' in r).toBe(true)
})

test('parsePagesParam: 越界/非法 → 报错', () => {
  expect('error' in parsePagesParam('10', 5)).toBe(true)
  expect('error' in parsePagesParam('0', 5)).toBe(true)
  expect('error' in parsePagesParam('abc', 5)).toBe(true)
  expect('error' in parsePagesParam('4-2', 5)).toBe(true)
})

test('PDF_MAX_PAGES_PER_READ 为 20', () => {
  expect(PDF_MAX_PAGES_PER_READ).toBe(20)
})

// ── formatPdfOutput ──────────────────────────────────────────────────────
test('formatPdfOutput: 带页码锚点与 total_pages', () => {
  const out = formatPdfOutput('a.pdf', [1, 2], 312, ['first', 'second'])
  expect(out).toContain('<pdf path="a.pdf"')
  expect(out).toContain('total_pages="312"')
  expect(out).toContain('--- Page 1 ---')
  expect(out).toContain('first')
  expect(out).toContain('--- Page 2 ---')
  expect(out).toContain('second')
  expect(out).toContain('</pdf>')
})

// ── extractPdfText（真实 unpdf）──────────────────────────────────────────
test('extractPdfText: 真实 PDF 逐页抽取文字层', async () => {
  const bytes = buildTestPdf(['Hello PDF', 'Second Page Text'])
  const r = await extractPdfText(bytes)
  expect(r.totalPages).toBe(2)
  expect(r.texts[0]).toContain('Hello PDF')
  expect(r.texts[1]).toContain('Second Page Text')
})

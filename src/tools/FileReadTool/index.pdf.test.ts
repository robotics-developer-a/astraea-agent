// 方案 B / §5-#5 集成：FileReadTool 的 PDF 专用路径 + 非 PDF 二进制嗅探
import { test, expect, afterAll } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileReadTool } from './index'
import { DEFAULT_TOOL_CONTEXT } from '../Tool'
import { buildTestPdf } from './buildTestPdf'

const tmp: string[] = []
async function mkpdf(pages: string[]): Promise<string> {
  const p = join(tmpdir(), `astraea-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  await Bun.write(p, buildTestPdf(pages))
  tmp.push(p)
  return p
}
async function mkbin(name: string, bytes: Uint8Array): Promise<string> {
  const p = join(tmpdir(), `astraea-bin-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`)
  await Bun.write(p, bytes)
  tmp.push(p)
  return p
}
afterAll(async () => { for (const p of tmp) await Bun.file(p).delete().catch(() => {}) })

const read = (input: Record<string, unknown>) => FileReadTool.call(input, DEFAULT_TOOL_CONTEXT)

test('PDF：默认抽取文字层，带 <pdf> 锚点与 total_pages', async () => {
  const p = await mkpdf(['Hello PDF', 'Second Page Text'])
  const r = await read({ file_path: p })
  expect(r.isError).toBeFalsy()
  expect(r.output).toContain('<pdf')
  expect(r.output).toContain('total_pages="2"')
  expect(r.output).toContain('Hello PDF')
  expect(r.output).toContain('--- Page 2 ---')
})

test('PDF：pages 参数只取指定页', async () => {
  const p = await mkpdf(['Hello PDF', 'Second Page Text'])
  const r = await read({ file_path: p, pages: '2' })
  expect(r.isError).toBeFalsy()
  expect(r.output).toContain('Second Page Text')
  expect(r.output).not.toContain('Hello PDF')
})

test('PDF：页码越界 → 报错', async () => {
  const p = await mkpdf(['only one page'])
  const r = await read({ file_path: p, pages: '5' })
  expect(r.isError).toBe(true)
})

test('PDF：无文字层（扫描件）→ 友好报错，不吐乱码', async () => {
  const p = await mkpdf(['']) // 空文字层
  const r = await read({ file_path: p })
  expect(r.isError).toBe(true)
  expect(r.output.toLowerCase()).toContain('text layer')
})

test('§5-#5：非 PDF 二进制文件 → 友好报错而非乱码', async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff]) // 含 NUL
  const p = await mkbin('img.png', bytes)
  const r = await read({ file_path: p })
  expect(r.isError).toBe(true)
  expect(r.output.toLowerCase()).toContain('binary')
})

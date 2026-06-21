// 方案 A: FileReadTool 三道闸门集成测试（用真实临时文件）
import { test, expect, afterAll } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileReadTool } from './index'
import { DEFAULT_TOOL_CONTEXT } from '../Tool'

const tmp: string[] = []
async function mkfile(name: string, content: string): Promise<string> {
  const p = join(tmpdir(), `astraea-read-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`)
  await Bun.write(p, content)
  tmp.push(p)
  return p
}
afterAll(async () => { for (const p of tmp) await Bun.file(p).delete().catch(() => {}) })

const read = (input: Record<string, unknown>) => FileReadTool.call(input, DEFAULT_TOOL_CONTEXT)

test('小文件：正常返回带行号内容', async () => {
  const p = await mkfile('small.txt', 'alpha\nbeta\ngamma')
  const r = await read({ file_path: p })
  expect(r.isError).toBeFalsy()
  expect(r.output).toContain('1\talpha')
  expect(r.output).toContain('3\tgamma')
})

test('默认行数上限：超 2000 行且无 limit → 只返回前 2000 行 + 续读提示', async () => {
  const lines = Array.from({ length: 3000 }, (_, i) => `L${i + 1}`).join('\n')
  const p = await mkfile('long.txt', lines)
  const r = await read({ file_path: p })
  expect(r.isError).toBeFalsy()
  expect(r.output).toContain('2000\tL2000')
  expect(r.output).not.toContain('L2001')
  expect(r.output.toLowerCase()).toContain('offset') // 续读提示引导用 offset
})

test('offset/limit 小范围读：精确返回该范围', async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `L${i + 1}`).join('\n')
  const p = await mkfile('range.txt', lines)
  const r = await read({ file_path: p, offset: 10, limit: 3 })
  expect(r.isError).toBeFalsy()
  expect(r.output).toContain('10\tL10')
  expect(r.output).toContain('12\tL12')
  expect(r.output).not.toContain('L13')
  expect(r.output).not.toContain('9\tL9')
})

test('体积闸门：>256KB 且无 limit → 报错且不含文件内容', async () => {
  const marker = 'UNIQUE_SENTINEL_XYZ'
  const big = marker + 'x'.repeat(300_000)
  const p = await mkfile('big.txt', big)
  const r = await read({ file_path: p })
  expect(r.isError).toBe(true)
  expect(r.output).not.toContain(marker)
  expect(r.output.toLowerCase()).toContain('offset')
})

test('token 闸门：切片估算超上限 → 报错且不含文件内容', async () => {
  // 50 行 × 2400 字符 ≈ 120KB（过软上限）；token ≈ 30000 > 任何 provider 的 CEIL(25000)
  const marker = 'TOKEN_SENTINEL_QWE'
  const line = marker + 'y'.repeat(2400)
  const content = Array.from({ length: 50 }, () => line).join('\n')
  const p = await mkfile('dense.txt', content)
  const r = await read({ file_path: p, limit: 50 }) // 传 limit 绕过软体积闸门，命中 token 闸门
  expect(r.isError).toBe(true)
  expect(r.output).not.toContain(marker)
  expect(r.output.toLowerCase()).toContain('token')
})

test('文件不存在：报错', async () => {
  const r = await read({ file_path: join(tmpdir(), 'no-such-astraea-file.txt') })
  expect(r.isError).toBe(true)
})

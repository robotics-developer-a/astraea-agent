import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SpreadsheetTool } from './index'
import { DEFAULT_TOOL_CONTEXT } from '../Tool'

let tempDir = ''

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
})

function tmpXlsx(name: string): string {
  tempDir = mkdtempSync(join(tmpdir(), 'astraea-spreadsheet-'))
  return join(tempDir, name)
}

test('writes and reads a simple xlsx workbook as markdown', async () => {
  const filePath = tmpXlsx('sales.xlsx')

  const written = await SpreadsheetTool.call({
    action: 'write',
    file_path: filePath,
    sheet: 'Sales',
    rows: [
      ['Region', 'Revenue', 'Margin'],
      ['North', 1200, 0.32],
      ['South', 950, 0.28],
    ],
  }, { ...DEFAULT_TOOL_CONTEXT, mode: 'forge' })

  expect(written.isError).toBeUndefined()

  const read = await SpreadsheetTool.call({
    action: 'read',
    file_path: filePath,
  }, DEFAULT_TOOL_CONTEXT)

  expect(read.isError).toBeUndefined()
  expect(read.output).toContain('Workbook: sales.xlsx')
  expect(read.output).toContain('Sheet: Sales')
  expect(read.output).toContain('| Region | Revenue | Margin |')
  expect(read.output).toContain('| North | 1200 | 0.32 |')
})

test('read rejects legacy xls with a clear message', async () => {
  const result = await SpreadsheetTool.call({
    action: 'read',
    file_path: tmpXlsx('legacy.xls'),
  }, DEFAULT_TOOL_CONTEXT)

  expect(result.isError).toBe(true)
  expect(result.output).toContain('Legacy .xls')
})

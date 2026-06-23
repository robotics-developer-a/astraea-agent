import { test, expect } from 'bun:test'
import React from 'react'
import { render } from 'ink-testing-library'
import { groupCalls, type ToolCall } from './ToolBatch'
import { ToolBatch } from './ToolBatch'

const call = (name: string, id: string, status: ToolCall['status'] = 'done'): ToolCall => ({
  toolUseId: id,
  name,
  argText: `${name}-arg`,
  status,
  resultLines: ['ok'],
})

test('groupCalls: 同名连续 ≥2 且属折叠集 → collapsed', () => {
  const groups = groupCalls([call('Glob', '1'), call('Glob', '2'), call('Glob', '3')])
  expect(groups).toHaveLength(1)
  expect(groups[0]!.collapsed).toBe(true)
  expect(groups[0]!.calls).toHaveLength(3)
})

test('groupCalls: 单个折叠集工具不折叠（需 ≥2）', () => {
  const groups = groupCalls([call('Read', '1')])
  expect(groups).toHaveLength(1)
  expect(groups[0]!.collapsed).toBe(false)
})

test('groupCalls: 非折叠集工具即便连续也不折叠', () => {
  const groups = groupCalls([call('Write', '1'), call('Write', '2')])
  expect(groups[0]!.collapsed).toBe(false)
  expect(groups[0]!.calls).toHaveLength(2)
})

test('groupCalls: 不同名打断分组', () => {
  const groups = groupCalls([
    call('Glob', '1'), call('Glob', '2'),
    call('Read', '3'),
    call('Glob', '4'), call('Glob', '5'),
  ])
  expect(groups).toHaveLength(3)
  expect(groups[0]!.collapsed).toBe(true)   // Glob ×2
  expect(groups[1]!.collapsed).toBe(false)  // Read ×1
  expect(groups[2]!.collapsed).toBe(true)   // Glob ×2
})

test('groupCalls: 混合 Glob/Read/Grep/Bash 各自折叠', () => {
  const groups = groupCalls([
    call('Bash', '1'), call('Bash', '2'),
    call('Grep', '3'), call('Grep', '4'),
  ])
  expect(groups).toHaveLength(2)
  expect(groups.every(g => g.collapsed)).toBe(true)
})

test('groupCalls: running 调用也计入分组', () => {
  const groups = groupCalls([call('Glob', '1', 'done'), call('Glob', '2', 'running')])
  expect(groups[0]!.collapsed).toBe(true)
  expect(groups[0]!.calls.map(c => c.status)).toEqual(['done', 'running'])
})

test('groupCalls: 空输入 → 空数组', () => {
  expect(groupCalls([])).toEqual([])
})

test('ToolBatch: 带 ANSI 的长结果行单行截断，避免续行顶到左边', () => {
  ;(process.stdout as { columns?: number }).columns = 44
  const ansiLine = `\x1b[48;2;20;51;33m+ ${'verificationCommand'.repeat(8)}\x1b[0m`
  const { lastFrame } = render(
    React.createElement(ToolBatch, {
      calls: [{
        toolUseId: '1',
        name: 'Edit',
        argText: 'src/ui/recentUpdates.ts',
        status: 'done',
        resultLines: ['Updated → src/ui/recentUpdates.ts', ansiLine],
      }],
    }),
  )

  const frame = lastFrame() ?? ''
  const resultLines = frame.split('\n').filter(line => line.includes('verificationCommand'))
  expect(resultLines).toHaveLength(1)
  expect(resultLines[0]!.startsWith('   ')).toBe(true)
})

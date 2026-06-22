// formatToolArg — TodoWrite 工具头参数格式化。
// TodoWrite 内联渲染后,工具头若铺原始 JSON({"todos":[...]})既丑又无信息;
// 应显示 "N tasks"。
import { test, expect } from 'bun:test'
import { formatToolArg } from './App'

test('TodoWrite → N tasks（而非原始 JSON）', () => {
  const input = { todos: [
    { id: '1', content: '甲', status: 'pending' },
    { id: '2', content: '乙', status: 'in_progress' },
    { id: '3', content: '丙', status: 'completed' },
  ] }
  expect(formatToolArg('TodoWrite', input)).toBe('3 tasks')
})

test('TodoWrite 空清单 → 0 tasks', () => {
  expect(formatToolArg('TodoWrite', { todos: [] })).toBe('0 tasks')
})

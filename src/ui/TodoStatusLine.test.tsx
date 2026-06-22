// TodoStatusLine — 恒高单行 todo 摘要的行为测试。
// 取代可变高度的浮动 TodoPanel：永远 1 行(有 todo)或 0 行(无 todo),
// 不再把输入框和最新消息顶飞。
import React from 'react'
import { test, expect, afterEach } from 'bun:test'
import { render } from 'ink-testing-library'
import { TodoStatusLine } from './TodoStatusLine'
import { setTodos, clearTodos, getTodos } from '../services/todo-state'

const NS = 'main'
const strip = (s: string | undefined) => (s ?? '').replace(/\[[0-9;]*m/g, '')
const tick = () => new Promise((r) => setTimeout(r, 350)) // > POLL_MS(300)

// 每次 render 登记，afterEach 统一 unmount —— 否则组件的 300ms 轮询定时器跨测试残留，
// 污染后续用例的渲染帧。
let mounted: Array<() => void> = []
const mount = (el: React.ReactElement) => {
  const r = render(el)
  mounted.push(r.unmount)
  return r
}

afterEach(() => {
  mounted.forEach(u => u())
  mounted = []
  clearTodos(NS)
})

test('无 todo → 不渲染任何内容(0 行)', () => {
  const { lastFrame } = mount(<TodoStatusLine columns={80} />)
  expect(strip(lastFrame()).trim()).toBe('')
})

test('有 todo → 单行显示三态计数 ○p ◉i ●c', async () => {
  setTodos([
    { id: '1', content: '甲', status: 'completed' },
    { id: '2', content: '乙', status: 'in_progress' },
    { id: '3', content: '丙', status: 'pending' },
    { id: '4', content: '丁', status: 'pending' },
  ], NS)
  const { lastFrame } = mount(<TodoStatusLine columns={80} />)
  await tick()
  const frame = strip(lastFrame())
  expect(frame).toContain('○2')   // pending
  expect(frame).toContain('◉1')   // in_progress
  expect(frame).toContain('●1')   // completed
  // 恒高：只有一行
  expect(frame.trim().split('\n').length).toBe(1)
})

test('有 in_progress → 单行带上当前任务名', async () => {
  setTodos([
    { id: '1', content: '正在重写渲染层', status: 'in_progress' },
    { id: '2', content: '待办', status: 'pending' },
  ], NS)
  const { lastFrame } = mount(<TodoStatusLine columns={80} />)
  await tick()
  expect(strip(lastFrame())).toContain('正在重写渲染层')
})

test('全部 completed → 自动清空,摘要行消失', async () => {
  setTodos([
    { id: '1', content: '甲', status: 'completed' },
    { id: '2', content: '乙', status: 'completed' },
  ], NS)
  const { lastFrame } = mount(<TodoStatusLine columns={80} />)
  await tick()
  // 自清后摘要归零、不残留 ●N
  expect(strip(lastFrame()).trim()).toBe('')
  expect(getTodos(NS).length).toBe(0)
})

test('当前任务名超宽 → 截断成单行(不折行)', async () => {
  setTodos([
    { id: '1', content: '这是一个非常非常非常非常非常非常非常非常长的任务名称会超出窄终端宽度', status: 'in_progress' },
  ], NS)
  const { lastFrame } = mount(<TodoStatusLine columns={20} />)
  await tick()
  const frame = strip(lastFrame())
  expect(frame.trim().split('\n').length).toBe(1)
  expect(frame).toContain('…')
})

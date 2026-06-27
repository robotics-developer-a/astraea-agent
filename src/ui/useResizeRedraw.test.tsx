// useResizeRedraw 验收 —— 锁定「终端 resize → 去抖后整屏重铺」的行为契约：
//   · 挂载帧不触发（避免开屏就清屏闪一下）
//   · 尺寸变化 → 去抖后触发一次
//   · 一次拖拽里的快速连变 → 只触发一次（去抖）
//   · 同值重渲（尺寸没变）→ 不触发
//   · 变化后立即卸载 → 定时器被清理，不触发
// 断言落在 onResize 这个副作用回调上（不看渲染帧）——绕开 Ink 测试环境对 effect/定时器
// 重渲的输出节流（见 ModeBanner.test.tsx 注），故稳定不抖。
import React from 'react'
import { test, expect, afterEach, mock } from 'bun:test'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { useResizeRedraw } from './useResizeRedraw'

const DELAY = 30                                  // 测试用短去抖窗口，加速跑测
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function Harness({ columns, rows, onResize }: { columns: number; rows: number; onResize: () => void }) {
  useResizeRedraw(columns, rows, onResize, DELAY)
  return <Text>x</Text>
}

let cleanup: (() => void) | null = null
afterEach(() => { cleanup?.(); cleanup = null })

test('挂载帧不触发重铺', async () => {
  const onResize = mock(() => {})
  const { unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(0)
})

test('尺寸变化 → 去抖后触发一次', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  rerender(<Harness columns={120} rows={24} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(1)
})

test('rows 变化（仅高度）也触发', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  rerender(<Harness columns={80} rows={40} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(1)
})

test('快速连变（模拟拖拽）只触发一次', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  // 连发多次尺寸变化、之间不等待 → 每次都清掉上一个定时器重计时，只末尾那次该落地。
  rerender(<Harness columns={90} rows={24} onResize={onResize} />)
  rerender(<Harness columns={100} rows={24} onResize={onResize} />)
  rerender(<Harness columns={70} rows={30} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(1)
})

test('同值重渲（尺寸未变）不触发', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  rerender(<Harness columns={80} rows={24} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(0)
})

test('变化后立即卸载 → 定时器被清理，不触发', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  rerender(<Harness columns={120} rows={24} onResize={onResize} />)
  unmount()                       // 去抖窗口未到就卸载 → cleanup 应 clearTimeout
  cleanup = null
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(0)
})

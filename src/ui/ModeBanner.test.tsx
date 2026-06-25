// ModeInputFrame 验收 —— 锁定手绘四边框的结构不变量（彗星动画为定时器驱动，这里只验静态/挂载）：
//   · 四角 ┌┐└┘ 齐全、上下边为横线、左右为竖线 → 边框闭合
//   · 模式标签嵌在上边框中央
//   · running 切换（true/false）下都能渲染、不崩，且依旧是闭合四边框
import React from 'react'
import { test, expect, afterEach } from 'bun:test'
import { render } from 'ink-testing-library'
import { ModeInputFrame } from './ModeBanner'
import { Text } from 'ink'

const strip = (s?: string) => (s ?? '').replace(/\[[0-9;]*m/g, '')

const renderFrame = (running: boolean) =>
  render(
    <ModeInputFrame mode="cruise" running={running}>
      <Text>hello</Text>
    </ModeInputFrame>,
  )

let cleanup: (() => void) | null = null
afterEach(() => { cleanup?.(); cleanup = null })

test('静态四边框：四角齐全、含横竖边与模式标签，框体闭合', () => {
  const { lastFrame, unmount } = renderFrame(false)
  cleanup = unmount
  const out = strip(lastFrame())

  // 四角
  for (const corner of ['┌', '┐', '└', '┘']) {
    expect(out).toContain(corner)
  }
  // 横边与竖边
  expect(out).toContain('─')
  expect(out).toContain('│')
  // 模式标签嵌在上边框
  expect(out).toContain('cruise')
  // 内容被包住
  expect(out).toContain('hello')
})

test('running=true 仍渲染闭合四边框（跑马灯挂载不破版）', () => {
  const { lastFrame, unmount } = renderFrame(true)
  cleanup = unmount
  const out = strip(lastFrame())
  for (const corner of ['┌', '┐', '└', '┘']) {
    expect(out).toContain(corner)
  }
  expect(out).toContain('hello')
})

test('上下边框等宽 → 框体不歪斜', () => {
  const { lastFrame, unmount } = renderFrame(false)
  cleanup = unmount
  const ls = strip(lastFrame()).split('\n').filter(l => l.trim().length > 0)
  const top = ls.find(l => l.includes('┌'))
  const bot = ls.find(l => l.includes('└'))
  expect(top).toBeDefined()
  expect(bot).toBeDefined()
  expect([...(top ?? '')].length).toBe([...(bot ?? '')].length)
})

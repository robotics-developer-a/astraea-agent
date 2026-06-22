import { test, expect } from 'bun:test'
import { hasLiveBody } from './liveFrame'

// turn 起点（上一条是 user）正文/工具都还没来 → live 帧不该渲染，
// 否则会先画一个空的 ✸ Astraea 头、干等思考、内容才姗姗冒出（问题3）。
test('no streaming text, no tools, no active tool → no live body', () => {
  expect(hasLiveBody({ streamingText: '', liveToolCount: 0, activeTool: null })).toBe(false)
})

test('streaming text present → has body', () => {
  expect(hasLiveBody({ streamingText: 'Looking at…', liveToolCount: 0, activeTool: null })).toBe(true)
})

test('live tools in flight → has body', () => {
  expect(hasLiveBody({ streamingText: '', liveToolCount: 2, activeTool: null })).toBe(true)
})

test('secondary active tool (single-line spinner) → has body', () => {
  expect(hasLiveBody({ streamingText: '', liveToolCount: 0, activeTool: 'WechatRead' })).toBe(true)
})

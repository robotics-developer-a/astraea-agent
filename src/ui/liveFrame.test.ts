import { test, expect } from 'bun:test'
import {
  COPY_FRIENDLY_PREVIEW_INTERVAL_MS,
  hasLiveBody,
  shouldPublishLiveTextPreview,
  shouldRenderAgentActivity,
} from './liveFrame'

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

test('permission confirmation owns the live frame while a tool waits for approval', () => {
  expect(shouldRenderAgentActivity({ isStreaming: true, hasPendingConfirm: true })).toBe(false)
})

test('agent activity remains visible during ordinary streaming', () => {
  expect(shouldRenderAgentActivity({ isStreaming: true, hasPendingConfirm: false })).toBe(true)
})

test('copy-friendly live text preview skips updates inside the quiet interval', () => {
  const first = shouldPublishLiveTextPreview({ now: 1_000, lastPublishedAt: null })
  expect(first).toBe(true)

  const tooSoon = shouldPublishLiveTextPreview({
    now: 1_000 + COPY_FRIENDLY_PREVIEW_INTERVAL_MS - 1,
    lastPublishedAt: 1_000,
  })
  expect(tooSoon).toBe(false)

  const afterInterval = shouldPublishLiveTextPreview({
    now: 1_000 + COPY_FRIENDLY_PREVIEW_INTERVAL_MS,
    lastPublishedAt: 1_000,
  })
  expect(afterInterval).toBe(true)
})

test('copy-friendly live text preview can be forced for terminal state changes', () => {
  expect(shouldPublishLiveTextPreview({
    now: 1_001,
    lastPublishedAt: 1_000,
    force: true,
  })).toBe(true)
})

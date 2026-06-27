// useResizeRedraw acceptance — locks the "terminal resize -> debounced full redraw" contract:
//   · no redraw on the mount frame (don't flash-clear on open)
//   · a size change triggers exactly one redraw after the debounce
//   · rapid changes within one drag coalesce to a single redraw
//   · a re-render with unchanged dimensions does not trigger
//   · unmounting before the debounce fires clears the timer (no redraw)
// Assertions observe the onResize side-effect callback (not the rendered frame), which sidesteps
// Ink's test-env throttling of effect/timer-driven re-renders (see ModeBanner.test.tsx note), so
// they stay stable.
import React from 'react'
import { test, expect, afterEach, mock } from 'bun:test'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { useResizeRedraw } from './useResizeRedraw'

const DELAY = 30                                  // short debounce window to keep tests fast
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function Harness({ columns, rows, onResize }: { columns: number; rows: number; onResize: () => void }) {
  useResizeRedraw(columns, rows, onResize, DELAY)
  return <Text>x</Text>
}

let cleanup: (() => void) | null = null
afterEach(() => { cleanup?.(); cleanup = null })

test('no redraw on the mount frame', async () => {
  const onResize = mock(() => {})
  const { unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(0)
})

test('a size change triggers one redraw after the debounce', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  rerender(<Harness columns={120} rows={24} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(1)
})

test('a rows-only change (height) also triggers', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  rerender(<Harness columns={80} rows={40} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(1)
})

test('rapid changes (simulated drag) trigger only once', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  // Fire several size changes back to back with no wait between them -> each clears the previous
  // timer and restarts it, so only the last one should land.
  rerender(<Harness columns={90} rows={24} onResize={onResize} />)
  rerender(<Harness columns={100} rows={24} onResize={onResize} />)
  rerender(<Harness columns={70} rows={30} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(1)
})

test('a re-render with unchanged dimensions does not trigger', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  cleanup = unmount
  rerender(<Harness columns={80} rows={24} onResize={onResize} />)
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(0)
})

test('unmounting before the debounce fires clears the timer (no redraw)', async () => {
  const onResize = mock(() => {})
  const { rerender, unmount } = render(<Harness columns={80} rows={24} onResize={onResize} />)
  rerender(<Harness columns={120} rows={24} onResize={onResize} />)
  unmount()                       // unmount before the debounce window elapses -> cleanup should clearTimeout
  cleanup = null
  await sleep(DELAY * 3)
  expect(onResize.mock.calls.length).toBe(0)
})

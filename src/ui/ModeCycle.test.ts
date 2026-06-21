import { test, expect } from 'bun:test'
import { MODE_CYCLE, nextCycleMode } from './ModeSelector'

test('nextCycleMode advances through the full cycle and wraps', () => {
  // 顺序: orbit → cruise → forge → counsel → default → orbit
  let m = MODE_CYCLE[0]
  const visited = [m]
  for (let i = 0; i < MODE_CYCLE.length; i++) {
    m = nextCycleMode(m)
    visited.push(m)
  }
  expect(visited).toEqual(['orbit', 'cruise', 'forge', 'counsel', 'default', 'orbit'])
})

test('nextCycleMode wraps from the last entry back to the first', () => {
  const last = MODE_CYCLE[MODE_CYCLE.length - 1]
  expect(nextCycleMode(last)).toBe(MODE_CYCLE[0])
})

test('an unknown/legacy mode falls into the cycle at the first entry', () => {
  // indexOf === -1 → (-1 + 1) % len === 0 → orbit，永不卡死
  expect(nextCycleMode('totally-unknown' as never)).toBe(MODE_CYCLE[0])
})

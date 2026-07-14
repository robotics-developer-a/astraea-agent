import { test, expect, describe } from 'bun:test'
import { withTimeout, combineSignals } from './withTimeout'

describe('withTimeout', () => {
  test('按时完成的 promise 原样返回', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'fast op')
    expect(result).toBe(42)
  })

  test('超时 reject 并带 label 与毫秒数', async () => {
    const never = new Promise<never>(() => {})
    await expect(withTimeout(never, 20, 'stuck op')).rejects.toThrow('stuck op timed out after 20ms')
  })

  test('超时触发 onTimeout 清理回调', async () => {
    let cleaned = false
    const never = new Promise<never>(() => {})
    await expect(
      withTimeout(never, 20, 'op', () => { cleaned = true }),
    ).rejects.toThrow()
    expect(cleaned).toBe(true)
  })

  test('onTimeout 抛错不吞掉超时错误本身', async () => {
    const never = new Promise<never>(() => {})
    await expect(
      withTimeout(never, 20, 'op', () => { throw new Error('cleanup boom') }),
    ).rejects.toThrow('op timed out')
  })

  test('底层 reject 原样透传(不被包装)', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('real failure')), 1000, 'op'),
    ).rejects.toThrow('real failure')
  })
})

describe('combineSignals', () => {
  test('无调用方信号时退化为纯超时信号', async () => {
    const s = combineSignals(undefined, 20)
    expect(s.aborted).toBe(false)
    await Bun.sleep(40)
    expect(s.aborted).toBe(true)
  })

  test('调用方信号先触发时立即 abort', () => {
    const ctrl = new AbortController()
    const s = combineSignals(ctrl.signal, 10_000)
    ctrl.abort()
    expect(s.aborted).toBe(true)
  })

  test('两者都未触发时保持未中止', () => {
    const ctrl = new AbortController()
    const s = combineSignals(ctrl.signal, 10_000)
    expect(s.aborted).toBe(false)
  })
})

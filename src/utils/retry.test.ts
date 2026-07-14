import { test, expect, describe } from 'bun:test'
import { withRetry, isTransientNetworkError } from './retry'

describe('isTransientNetworkError', () => {
  test.each([
    ['HTTP 500 Internal Server Error', true],
    ['Tavily API 返回 503', true],
    ['fetch failed', true],
    ['The operation timed out', true],
    ['operation was aborted', true],
    ['ECONNRESET', true],
    ['getaddrinfo ENOTFOUND api.example.com', true],
    ['HTTP 404 Not Found', false],
    ['Tavily API 返回 429', false],
    ['HTTP 401 Unauthorized', false],
    ['Unexpected token in JSON', false],
  ])('%s → retryable=%p', (msg, expected) => {
    expect(isTransientNetworkError(new Error(msg))).toBe(expected)
  })
})

describe('withRetry', () => {
  test('首次成功不重试', async () => {
    let calls = 0
    const result = await withRetry(async () => { calls++; return 'ok' }, { baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(calls).toBe(1)
  })

  test('瞬态错误重试后成功', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      if (calls < 3) throw new Error('HTTP 502 Bad Gateway')
      return 'recovered'
    }, { baseDelayMs: 1 })
    expect(result).toBe('recovered')
    expect(calls).toBe(3)
  })

  test('4xx 不重试,立即抛出', async () => {
    let calls = 0
    await expect(withRetry(async () => {
      calls++
      throw new Error('HTTP 403 Forbidden')
    }, { baseDelayMs: 1 })).rejects.toThrow('403')
    expect(calls).toBe(1)
  })

  test('重试耗尽后抛最后一个错误', async () => {
    let calls = 0
    await expect(withRetry(async () => {
      calls++
      throw new Error(`HTTP 500 (attempt ${calls})`)
    }, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('attempt 3')
    expect(calls).toBe(3)
  })

  test('用户取消后不再重试', async () => {
    const ctrl = new AbortController()
    let calls = 0
    await expect(withRetry(async () => {
      calls++
      ctrl.abort()
      throw new Error('HTTP 500')
    }, { signal: ctrl.signal, baseDelayMs: 1 })).rejects.toThrow('500')
    expect(calls).toBe(1)
  })

  test('自定义 shouldRetry 生效', async () => {
    let calls = 0
    await expect(withRetry(async () => {
      calls++
      throw new Error('custom fatal')
    }, { shouldRetry: () => false, baseDelayMs: 1 })).rejects.toThrow('custom fatal')
    expect(calls).toBe(1)
  })
})

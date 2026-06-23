import { test, expect } from 'bun:test'
import { APIUserAbortError } from '@anthropic-ai/sdk/core/error'
import { isAbortError } from './abortError'

test('原生 DOMException AbortError 被识别', () => {
  const err = new Error('aborted')
  err.name = 'AbortError'
  expect(isAbortError(err)).toBe(true)
})

test('SDK 的 APIUserAbortError 被识别（name 退化为 Error，靠 message）', () => {
  const err = new APIUserAbortError()
  // 回归守卫：SDK 的中止错误 name 不是 'AbortError'
  expect(err.name).not.toBe('AbortError')
  expect(isAbortError(err)).toBe(true)
})

test('裸字符串 message="Request was aborted." 被识别', () => {
  expect(isAbortError(new Error('Request was aborted.'))).toBe(true)
})

test('已 abort 的 signal 让任意错误都判为中止', () => {
  const ctrl = new AbortController()
  ctrl.abort()
  expect(isAbortError(new Error('connection reset'), ctrl.signal)).toBe(true)
})

test('普通错误不被误判为中止', () => {
  expect(isAbortError(new Error('500 internal server error'))).toBe(false)
  expect(isAbortError('not an error')).toBe(false)
  expect(isAbortError(undefined)).toBe(false)
})

test('未 abort 的 signal 不影响普通错误判定', () => {
  const ctrl = new AbortController()
  expect(isAbortError(new Error('boom'), ctrl.signal)).toBe(false)
})

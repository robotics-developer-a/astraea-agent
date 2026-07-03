import { expect, test } from 'bun:test'
import { executeBash } from './shell'

// 超时/中断走 proc.kill()，exited 正常 resolve——曾经的实现只在 catch 里设标志，
// 导致超时命令报告 exitCode 0 / timedOut:false，模型把失败当成功。

test('a timed-out command reports timedOut and a non-zero exit code', async () => {
  const result = await executeBash({ command: 'sleep 5', timeout: 200 })
  expect(result.timedOut).toBe(true)
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain('timed out')
}, 10_000)

test('an aborted command reports interrupted and a non-zero exit code', async () => {
  const controller = new AbortController()
  const pending = executeBash({ command: 'sleep 5' }, controller.signal)
  setTimeout(() => controller.abort(), 150)
  const result = await pending
  expect(result.interrupted).toBe(true)
  expect(result.timedOut).toBe(false)
  expect(result.exitCode).not.toBe(0)
}, 10_000)

test('a successful command still reports exit 0 with clean flags', async () => {
  const result = await executeBash({ command: 'echo ok' })
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('ok')
  expect(result.timedOut).toBe(false)
  expect(result.interrupted).toBe(false)
}, 10_000)

test('a failing command propagates its real exit code', async () => {
  const result = await executeBash({ command: 'exit 3' })
  expect(result.exitCode).toBe(3)
  expect(result.timedOut).toBe(false)
  expect(result.interrupted).toBe(false)
}, 10_000)

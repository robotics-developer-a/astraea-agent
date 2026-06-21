// §5-#8: 子 agent 并发上限（防 provider 429 + 成本尖峰）
import { test, expect, afterEach } from 'bun:test'
import {
  acquireAgentSlot,
  releaseAgentSlot,
  resetAgentConcurrency,
  maxConcurrentAgents,
} from './agent-concurrency'

afterEach(() => {
  delete process.env.ASTRAEA_MAX_CONCURRENT_AGENTS
  resetAgentConcurrency()
})

test('maxConcurrentAgents: 默认 5，env 可覆盖', () => {
  expect(maxConcurrentAgents()).toBe(5)
  process.env.ASTRAEA_MAX_CONCURRENT_AGENTS = '3'
  expect(maxConcurrentAgents()).toBe(3)
})

test('超出上限的 acquire 被阻塞，直到一次 release 才放行', async () => {
  process.env.ASTRAEA_MAX_CONCURRENT_AGENTS = '2'
  resetAgentConcurrency()
  await acquireAgentSlot()
  await acquireAgentSlot()
  let third = false
  const p = acquireAgentSlot().then(() => { third = true })
  await new Promise(r => setTimeout(r, 10))
  expect(third).toBe(false)        // 第 3 个被挡住
  releaseAgentSlot()
  await p
  expect(third).toBe(true)         // 释放一个后放行
})

test('release 无等待者时释放槽位，可再次立即 acquire', async () => {
  process.env.ASTRAEA_MAX_CONCURRENT_AGENTS = '1'
  resetAgentConcurrency()
  await acquireAgentSlot()
  releaseAgentSlot()
  let ok = false
  await acquireAgentSlot().then(() => { ok = true })
  expect(ok).toBe(true)
})

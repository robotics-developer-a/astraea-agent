import { test, expect, afterEach } from 'bun:test'
import { detectTerm, notifyTaskDone, notifyTaskError } from './terminalNotify'

const ENV_KEYS = ['TERM_PROGRAM', 'TERM', 'GHOSTTY_RESOURCES_DIR', 'KITTY_WINDOW_ID']
const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function setEnv(env: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
}

test('detectTerm 识别 iTerm2', () => {
  setEnv({ TERM_PROGRAM: 'iTerm.app' })
  expect(detectTerm()).toBe('iterm2')
})

test('detectTerm 把 WezTerm 归到 iterm2（兼容 OSC 9）', () => {
  setEnv({ TERM_PROGRAM: 'WezTerm' })
  expect(detectTerm()).toBe('iterm2')
})

test('detectTerm 识别 ghostty（TERM_PROGRAM 或资源目录）', () => {
  setEnv({ TERM_PROGRAM: 'ghostty' })
  expect(detectTerm()).toBe('ghostty')
  setEnv({ GHOSTTY_RESOURCES_DIR: '/x' })
  expect(detectTerm()).toBe('ghostty')
})

test('detectTerm 识别 kitty（窗口 id 或 TERM）', () => {
  setEnv({ KITTY_WINDOW_ID: '1' })
  expect(detectTerm()).toBe('kitty')
  setEnv({ TERM: 'xterm-kitty' })
  expect(detectTerm()).toBe('kitty')
})

test('detectTerm 识别 Apple_Terminal', () => {
  setEnv({ TERM_PROGRAM: 'Apple_Terminal' })
  expect(detectTerm()).toBe('apple')
})

test('detectTerm 未知终端回落 other', () => {
  setEnv({ TERM: 'xterm-256color' })
  expect(detectTerm()).toBe('other')
})

// send() 在 NODE_ENV=test 下短路（bun test 默认 NODE_ENV=test），这里只验证 API 不抛、
// 且 minDuration 门控逻辑在调用层成立——不真正写 tty。
test('notifyTaskDone / notifyTaskError 在测试环境静默且不抛', () => {
  expect(() => notifyTaskDone({ elapsedMs: 5000, summary: 'Done in 5s' })).not.toThrow()
  expect(() => notifyTaskError({ elapsedMs: 0, summary: 'boom' })).not.toThrow()
  expect(() => notifyTaskDone()).not.toThrow()
})

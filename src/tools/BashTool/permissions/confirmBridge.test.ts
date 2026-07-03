import { expect, test } from 'bun:test'
import {
  cancelAllConfirms,
  getPendingConfirm,
  hasPendingConfirm,
  onConfirmRequest,
  requestConfirm,
  resolveConfirm,
  type ConfirmRequest,
} from './confirmBridge'

// 主 agent 与后台 sub-agent 共享本 bridge，确认请求可能并发到达。
// 单槽位实现会让后到的覆盖先到的，先到的 Promise 永远悬挂 → 工具卡死。
test('concurrent confirm requests are answered one by one, none is lost', async () => {
  const shown: string[] = []
  const unsubscribe = onConfirmRequest(req => { shown.push(req.command) })
  try {
    const first = requestConfirm({ command: 'rm -rf build' })
    const second = requestConfirm({ command: 'git push' })

    // UI 只被推送了队头；第二个请求在排队，不覆盖第一个
    expect(shown).toEqual(['rm -rf build'])
    expect(getPendingConfirm()?.command).toBe('rm -rf build')

    resolveConfirm({ proceed: true, remember: null })
    // 队头 resolve 后，下一个请求自动推送给 UI
    expect(shown).toEqual(['rm -rf build', 'git push'])
    expect(getPendingConfirm()?.command).toBe('git push')

    resolveConfirm({ proceed: false, remember: null })
    expect(hasPendingConfirm()).toBe(false)

    await expect(first).resolves.toEqual({ proceed: true, remember: null })
    await expect(second).resolves.toEqual({ proceed: false, remember: null })
  } finally {
    unsubscribe()
  }
})

test('cancelAllConfirms fail-closes every queued request', async () => {
  const unsubscribe = onConfirmRequest(() => {})
  try {
    const a = requestConfirm({ command: 'a' })
    const b = requestConfirm({ command: 'b' })
    cancelAllConfirms()
    expect(hasPendingConfirm()).toBe(false)
    await expect(a).resolves.toEqual({ proceed: false, remember: null })
    await expect(b).resolves.toEqual({ proceed: false, remember: null })
  } finally {
    unsubscribe()
  }
})

test('last UI unsubscribe fail-closes orphaned requests instead of hanging them', async () => {
  const unsubscribe = onConfirmRequest(() => {})
  const pending = requestConfirm({ command: 'orphan' })
  unsubscribe()
  await expect(pending).resolves.toEqual({ proceed: false, remember: null })
  expect(hasPendingConfirm()).toBe(false)
})

test('without any UI subscriber a request fails closed immediately', async () => {
  const req: ConfirmRequest = { command: 'headless' }
  await expect(requestConfirm(req)).resolves.toEqual({ proceed: false, remember: null })
})

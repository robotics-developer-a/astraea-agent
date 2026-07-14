// MCP 包装层测试:熔断器 + 只读重试(可靠性审计 PR-4)
import { test, expect, describe } from 'bun:test'
import { mcpToolsToNativeTools } from './toTools'
import type { ConnectedMcpClient } from './transport'
import { DEFAULT_TOOL_CONTEXT } from '../tools/Tool'

function fakeConn(
  callImpl: () => Promise<unknown>,
  opts: { readOnly?: boolean } = {},
): ConnectedMcpClient {
  const def: Record<string, unknown> = {
    name: 'echo',
    description: 'test tool',
    inputSchema: { type: 'object', properties: {} },
  }
  if (opts.readOnly) def['annotations'] = { readOnlyHint: true }
  return {
    name: 'testsrv',
    client: { callTool: callImpl } as unknown as ConnectedMcpClient['client'],
    tools: [def as unknown as ConnectedMcpClient['tools'][0]],
    close: async () => {},
  }
}

const ok = { content: [{ type: 'text', text: 'pong' }] }

describe('MCP 熔断器', () => {
  test('连续 3 次传输层失败后熔断:后续调用快速失败,不再打到 server', async () => {
    let calls = 0
    const conn = fakeConn(async () => { calls++; throw new Error('transport down') })
    const tool = mcpToolsToNativeTools([conn])[0]!

    for (let i = 0; i < 3; i++) {
      const r = await tool.call({}, DEFAULT_TOOL_CONTEXT)
      expect(r.isError).toBe(true)
    }
    expect(calls).toBe(3)

    // 第 4 次:熔断快速失败,server 不被调用
    const r4 = await tool.call({}, DEFAULT_TOOL_CONTEXT)
    expect(r4.isError).toBe(true)
    expect(r4.output).toContain('degraded')
    expect(r4.output).toContain('/mcp')
    expect(calls).toBe(3)
  })

  test('第 3 次失败的错误消息里预告熔断', async () => {
    const conn = fakeConn(async () => { throw new Error('boom') })
    const tool = mcpToolsToNativeTools([conn])[0]!
    await tool.call({}, DEFAULT_TOOL_CONTEXT)
    await tool.call({}, DEFAULT_TOOL_CONTEXT)
    const r3 = await tool.call({}, DEFAULT_TOOL_CONTEXT)
    expect(r3.output).toContain('marked degraded')
  })

  test('成功调用复位失败计数', async () => {
    let fail = true
    let calls = 0
    const conn = fakeConn(async () => {
      calls++
      if (fail) throw new Error('flaky')
      return ok
    })
    const tool = mcpToolsToNativeTools([conn])[0]!

    await tool.call({}, DEFAULT_TOOL_CONTEXT) // fail 1
    await tool.call({}, DEFAULT_TOOL_CONTEXT) // fail 2
    fail = false
    const r = await tool.call({}, DEFAULT_TOOL_CONTEXT) // success → reset
    expect(r.isError).toBe(false)
    fail = true
    // 复位后需要再攒 3 次才熔断 —— 这两次都真实打到 server
    await tool.call({}, DEFAULT_TOOL_CONTEXT)
    await tool.call({}, DEFAULT_TOOL_CONTEXT)
    expect(calls).toBe(5)
  })

  test('工具自身的 isError(语义错误)不计入熔断', async () => {
    let calls = 0
    const conn = fakeConn(async () => { calls++; return { content: [{ type: 'text', text: 'bad input' }], isError: true } })
    const tool = mcpToolsToNativeTools([conn])[0]!
    for (let i = 0; i < 5; i++) {
      const r = await tool.call({}, DEFAULT_TOOL_CONTEXT)
      expect(r.isError).toBe(true)
    }
    expect(calls).toBe(5) // 从未熔断
  })
})

describe('MCP 只读重试', () => {
  test('readOnlyHint 工具瞬态失败重试一次后成功', async () => {
    let calls = 0
    const conn = fakeConn(async () => {
      calls++
      if (calls === 1) throw new Error('HTTP 503')
      return ok
    }, { readOnly: true })
    const tool = mcpToolsToNativeTools([conn])[0]!
    const r = await tool.call({}, DEFAULT_TOOL_CONTEXT)
    expect(r.isError).toBe(false)
    expect(r.output).toBe('pong')
    expect(calls).toBe(2)
  })

  test('写工具(无 readOnlyHint)绝不自动重试', async () => {
    let calls = 0
    const conn = fakeConn(async () => { calls++; throw new Error('HTTP 503') })
    const tool = mcpToolsToNativeTools([conn])[0]!
    const r = await tool.call({}, DEFAULT_TOOL_CONTEXT)
    expect(r.isError).toBe(true)
    expect(calls).toBe(1)
  })
})

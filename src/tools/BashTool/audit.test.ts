import { test, expect, describe, spyOn, afterEach } from 'bun:test'
import { BashTool } from './index.js'
import * as audit from '../../audit/record.js'
import type { ToolContext } from '../Tool.js'

const ctx = (mode: ToolContext['mode'], isInteractive = false): ToolContext => ({
  mode,
  isInteractive,
})

afterEach(() => spyOn(audit, 'recordDecision').mockRestore())

describe('BashTool emits a structured audit record', () => {
  test('hard-block (security check) → reason "hard-block", behavior deny', async () => {
    const spy = spyOn(audit, 'recordDecision').mockImplementation(() => {})
    const res = await BashTool.call({ command: 'cat $IFS/etc/passwd' }, ctx('forge'))
    expect(res.isError).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const r = spy.mock.calls[0]![0]
    expect(r.tool).toBe('Bash')
    expect(r.behavior).toBe('deny')
    expect(r.reason.type).toBe('hard-block')
  })

  test('ask rule with no interactive user → reason "fail-closed", behavior deny', async () => {
    const spy = spyOn(audit, 'recordDecision').mockImplementation(() => {})
    const res = await BashTool.call({ command: 'sudo echo hi' }, ctx('default', false))
    expect(res.isError).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const r = spy.mock.calls[0]![0]
    expect(r.behavior).toBe('deny')
    expect(r.reason.type).toBe('fail-closed')
    expect(r.target).toBe('sudo echo hi')
  })
})

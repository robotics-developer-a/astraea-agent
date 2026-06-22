import { test, expect, describe, spyOn, afterEach } from 'bun:test'
import { checkWritePermission } from './fileWriteGate.js'
import * as audit from '../audit/record.js'
import type { ToolContext } from './Tool.js'

const ctx = (mode: ToolContext['mode'], isInteractive = false): ToolContext => ({
  mode,
  isInteractive,
})

afterEach(() => spyOn(audit, 'recordDecision').mockRestore())

describe('checkWritePermission emits a structured audit record', () => {
  test('forge mode auto-allow → reason "mode", behavior allow', async () => {
    const spy = spyOn(audit, 'recordDecision').mockImplementation(() => {})
    await checkWritePermission('/tmp/astraea-test-foo.txt', ctx('forge'), 'write')
    expect(spy).toHaveBeenCalledTimes(1)
    const r = spy.mock.calls[0]![0]
    expect(r.behavior).toBe('allow')
    expect(r.reason.type).toBe('mode')
    expect(r.tool).toBe('FileWrite')
    expect(r.target).toBe('/tmp/astraea-test-foo.txt')
  })

  test('default mode, no interactive user → reason "fail-closed", behavior deny', async () => {
    const spy = spyOn(audit, 'recordDecision').mockImplementation(() => {})
    await checkWritePermission('/tmp/astraea-test-bar.txt', ctx('default', false), 'edit')
    expect(spy).toHaveBeenCalledTimes(1)
    const r = spy.mock.calls[0]![0]
    expect(r.behavior).toBe('deny')
    expect(r.reason.type).toBe('fail-closed')
    expect(r.tool).toBe('FileEdit')
  })

  test('orbit mode deny → reason "mode", behavior deny', async () => {
    const spy = spyOn(audit, 'recordDecision').mockImplementation(() => {})
    await checkWritePermission('/tmp/astraea-test-baz.txt', ctx('orbit'), 'write')
    expect(spy).toHaveBeenCalledTimes(1)
    const r = spy.mock.calls[0]![0]
    expect(r.behavior).toBe('deny')
    expect(r.reason.type).toBe('mode')
  })

  test('sensitive path downgrades to ask → reason "redline" (fail-closed deny when no user)', async () => {
    const spy = spyOn(audit, 'recordDecision').mockImplementation(() => {})
    // forge would normally allow, but .git/ is a red-line → downgraded to ask → fail-closed deny
    await checkWritePermission('/tmp/repo/.git/config', ctx('forge', false), 'write')
    expect(spy).toHaveBeenCalledTimes(1)
    const r = spy.mock.calls[0]![0]
    expect(r.behavior).toBe('deny')
    expect(r.reason.type).toBe('redline')
  })
})

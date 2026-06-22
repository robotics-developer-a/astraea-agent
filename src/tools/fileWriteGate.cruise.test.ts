import { test, expect, describe, spyOn, afterEach } from 'bun:test'
import { checkWritePermission } from './fileWriteGate.js'
import * as audit from '../audit/record.js'
import * as confirm from './BashTool/permissions/confirm.js'
import { getMode, setMode } from '../state/sessionMode.js'
import type { ToolContext } from './Tool.js'

const ctx = (mode: ToolContext['mode'], isInteractive = true): ToolContext => ({
  mode,
  isInteractive,
})

afterEach(() => {
  spyOn(audit, 'recordDecision').mockRestore()
  spyOn(confirm, 'confirmWithUser').mockRestore()
  setMode('default') // 复位进程级模式单例，避免污染其它测试
})

describe('checkWritePermission — 文件写「本会话全允许」切 cruise', () => {
  test('用户选 session-cruise → 切到 cruise，proceed + modeSwitch，审计记 remember', async () => {
    setMode('default')
    spyOn(audit, 'recordDecision').mockImplementation(() => {})
    spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: true, remember: 'session-cruise' })
    const auditSpy = audit.recordDecision as unknown as ReturnType<typeof spyOn>

    const r = await checkWritePermission('/tmp/astraea-cruise-1.txt', ctx('default'), 'write')

    expect(r.proceed).toBe(true)
    expect(r.modeSwitch).toBe('cruise')
    expect(getMode()).toBe('cruise')
    const rec = auditSpy.mock.calls[0]![0]
    expect(rec.behavior).toBe('allow')
    expect(rec.reason.type).toBe('user')
    expect(rec.remember).toBe('session-cruise')
  })

  test('确认框以 kind="file" 发起（文件写专属选项集）', async () => {
    setMode('default')
    spyOn(audit, 'recordDecision').mockImplementation(() => {})
    const confirmSpy = spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: true, remember: null })

    await checkWritePermission('/tmp/astraea-cruise-2.txt', ctx('default'), 'edit')

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0]![2]).toBe('file')
  })

  test('普通 Yes（remember=null）不切模式', async () => {
    setMode('default')
    spyOn(audit, 'recordDecision').mockImplementation(() => {})
    spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: true, remember: null })

    const r = await checkWritePermission('/tmp/astraea-cruise-3.txt', ctx('default'), 'write')

    expect(r.proceed).toBe(true)
    expect(r.modeSwitch).toBeUndefined()
    expect(getMode()).toBe('default')
  })
})

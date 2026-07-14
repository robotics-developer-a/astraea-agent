import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { ToolContext } from '../Tool.js'
import { PowerShellTool } from './index.js'
import * as confirm from '../BashTool/permissions/confirm.js'
import * as executor from './executor/powershell.js'

const ctx = (mode: ToolContext['mode'], isInteractive = false): ToolContext => ({
  mode,
  isInteractive,
})

afterEach(() => {
  spyOn(confirm, 'confirmWithUser').mockRestore()
  spyOn(executor, 'executePowerShell').mockRestore()
})

describe('PowerShellTool permission modes', () => {
  test('write commands remain execution-gated for orbit and counsel scheduler gates', () => {
    expect(PowerShellTool.isReadOnly({ command: 'Set-Content a.txt "x"' })).toBe(false)
    expect(PowerShellTool.isReadOnly({ command: 'Get-ChildItem; Remove-Item a' })).toBe(false)
  })

  test('read-only commands are recognized dynamically (aligned with Bash) — audit T8', () => {
    expect(PowerShellTool.isReadOnly({ command: 'Get-ChildItem' })).toBe(true)
    expect(PowerShellTool.isReadOnly({ command: 'Get-Content package.json' })).toBe(true)
  })

  test('read-only command executes without confirmation even when non-interactive (T8: unblocks Windows sub-agents)', async () => {
    const confirmSpy = spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: false, remember: null })
    const executeSpy = spyOn(executor, 'executePowerShell').mockResolvedValue({
      stdout: 'file list',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      interrupted: false,
    })

    const result = await PowerShellTool.call({ command: 'Get-ChildItem src' }, ctx('default', false))

    expect(result.isError).toBeFalsy()
    expect(result.output).toBe('file list')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(executeSpy).toHaveBeenCalledTimes(1)
  })

  test('forge mode runs ask-tier API commands without prompting', async () => {
    const confirmSpy = spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: false, remember: null })
    const executeSpy = spyOn(executor, 'executePowerShell').mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      interrupted: false,
    })

    const result = await PowerShellTool.call({
      command: 'Invoke-RestMethod http://localhost:3000/api/tasks -Method PUT',
    }, ctx('forge', true))

    expect(result.isError).toBeFalsy()
    expect(result.output).toBe('ok')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(executeSpy).toHaveBeenCalledTimes(1)
  })

  test('default mode still asks before ask-tier API commands', async () => {
    const confirmSpy = spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: false, remember: null })
    const executeSpy = spyOn(executor, 'executePowerShell').mockResolvedValue({
      stdout: 'should not run',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      interrupted: false,
    })

    const result = await PowerShellTool.call({
      command: 'Invoke-RestMethod http://localhost:3000/api/tasks -Method PUT',
    }, ctx('default', true))

    expect(result.isError).toBe(true)
    expect(result.output).toBe('Command cancelled by user.')
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).not.toHaveBeenCalled()
  })

  test('cruise mode still asks before shell execution', async () => {
    const confirmSpy = spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: false, remember: null })
    const executeSpy = spyOn(executor, 'executePowerShell').mockResolvedValue({
      stdout: 'should not run',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      interrupted: false,
    })

    const result = await PowerShellTool.call({
      command: 'Write-Output "hello"',
    }, ctx('cruise', true))

    expect(result.isError).toBe(true)
    expect(result.output).toBe('Command cancelled by user.')
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).not.toHaveBeenCalled()
  })

  test('default non-interactive mode denies instead of hanging on confirmation', async () => {
    const confirmSpy = spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: true, remember: null })
    const executeSpy = spyOn(executor, 'executePowerShell').mockResolvedValue({
      stdout: 'should not run',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      interrupted: false,
    })

    const result = await PowerShellTool.call({
      command: 'Write-Output "hello"',
    }, ctx('default', false))

    expect(result.isError).toBe(true)
    expect(result.output).toContain('fail-closed deny')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(executeSpy).not.toHaveBeenCalled()
  })

  test('forge mode still asks for bypass-immune sensitive paths', async () => {
    const confirmSpy = spyOn(confirm, 'confirmWithUser').mockResolvedValue({ proceed: false, remember: null })
    const executeSpy = spyOn(executor, 'executePowerShell').mockResolvedValue({
      stdout: 'should not run',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      interrupted: false,
    })

    const result = await PowerShellTool.call({
      command: 'Set-Content .astraea/settings.json "{}"',
    }, ctx('forge', true))

    expect(result.isError).toBe(true)
    expect(result.output).toBe('Command cancelled by user.')
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).not.toHaveBeenCalled()
  })
})

import { test, expect, describe } from 'bun:test'
import { isReadOnlyPowerShellCommand } from './readonly-check'

describe('isReadOnlyPowerShellCommand', () => {
  test.each([
    'Get-ChildItem',
    'Get-ChildItem -Recurse src',
    'get-content package.json',
    'Get-Process | Sort-Object CPU',
    'Get-ChildItem | Select-Object Name | Format-Table',
    'Select-String -Pattern "foo" -Path a.txt',
    'Test-Path C:\\temp',
    'ls',
    'dir src',
    'pwd',
    'Get-Item .\\a.txt | Measure-Object',
    'ConvertTo-Json -InputObject $x',
  ])('只读放行: %s', cmd => {
    expect(isReadOnlyPowerShellCommand(cmd)).toBe(true)
  })

  test.each([
    // 写操作动词
    'Set-Content a.txt "x"',
    'Remove-Item a.txt',
    'New-Item -ItemType File a.txt',
    'Move-Item a b',
    'Copy-Item a b',
    'Add-Content a.txt "x"',
    'Invoke-WebRequest https://x.com',
    'Start-Process notepad',
    // 复合结构/求值 —— 保守拒绝
    'Get-ChildItem; Remove-Item a.txt',
    'Get-Content a.txt > b.txt',
    'Get-ChildItem | ForEach-Object { Remove-Item $_ }',
    'Where-Object { $_.Name -eq "x" }',
    'Get-Content $(Get-Location)',
    'Get-ChildItem & whoami',
    'Get-Content `; rm x',
    // 管道中段含非只读命令
    'Get-Process | Stop-Process',
    // 空/无意义
    '',
    '   ',
  ])('保守拒绝: %s', cmd => {
    expect(isReadOnlyPowerShellCommand(cmd)).toBe(false)
  })
})

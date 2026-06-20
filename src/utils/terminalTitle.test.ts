import { test, expect } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatTitleDir, cleanPromptForTitle } from './terminalTitle'

const HOME = homedir()

test('formatTitleDir: home 本身 → ~', () => {
  expect(formatTitleDir(HOME)).toBe('~')
})

test('formatTitleDir: home 下深路径 → …/末两段', () => {
  expect(formatTitleDir(join(HOME, 'Documents', 'project', 'astraea', 'astraea')))
    .toBe('…/astraea/astraea')
})

test('formatTitleDir: home 直接子目录 → ~/name', () => {
  expect(formatTitleDir(join(HOME, 'astraea'))).toBe('~/astraea')
})

test('formatTitleDir: 绝对路径(非 home) 末两段', () => {
  expect(formatTitleDir('/usr/local/lib/node')).toBe('…/lib/node')
})

test('formatTitleDir: 短绝对路径原样保前导根', () => {
  expect(formatTitleDir('/usr/local')).toBe('/usr/local')
})

test('cleanPromptForTitle: 剥 system-reminder + 折单行', () => {
  const raw = '帮我实现标题栏\n\n<system-reminder>noise here</system-reminder>  '
  expect(cleanPromptForTitle(raw)).toBe('帮我实现标题栏')
})

test('cleanPromptForTitle: 剥本地命令包裹', () => {
  const raw = '<local-command-stdout>junk</local-command-stdout>真实指令'
  expect(cleanPromptForTitle(raw)).toBe('真实指令')
})

test('cleanPromptForTitle: 去 ANSI 转义', () => {
  expect(cleanPromptForTitle('\x1b[31m红字\x1b[0m')).toBe('红字')
})

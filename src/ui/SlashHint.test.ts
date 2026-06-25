import { describe, expect, test } from 'bun:test'
import { matchSlashCommands, trailingSlashToken } from './SlashHint'

describe('SlashHint command matching', () => {
  test('offers /init from the slash command picker', () => {
    const matches = matchSlashCommands('/in')

    expect(matches.map(command => command.name)).toContain('/init')
  })

  test('recognizes a slash token mid-line (text before it)', () => {
    // 句中识别：前面有文字也要认出末尾正在输入的 /token
    const matches = matchSlashCommands('我爱 /fron')
    expect(matches.map(c => c.name)).toContain('/frontend-design')
  })

  test('keeps preceding text as the completion prefix', () => {
    const t = trailingSlashToken('我爱 /fron')
    expect(t).toEqual({ prefix: '我爱 ', token: '/fron' })
  })

  test('does not trigger on file paths or args', () => {
    // 词中斜杠（src/foo）、含第二个斜杠（/tmp/foo）、带参（/goal foo）都不应弹命令
    expect(matchSlashCommands('cd src/foo')).toEqual([])
    expect(matchSlashCommands('看看 /tmp/foo')).toEqual([])
    expect(matchSlashCommands('/goal foo')).toEqual([])
    expect(trailingSlashToken('hello world')).toBeNull()
  })
})

import { describe, expect, test } from 'bun:test'
import { matchSlashCommands } from './SlashHint'

describe('SlashHint command matching', () => {
  test('offers /init from the slash command picker', () => {
    const matches = matchSlashCommands('/in')

    expect(matches.map(command => command.name)).toContain('/init')
  })
})

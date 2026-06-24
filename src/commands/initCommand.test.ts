import { describe, expect, test } from 'bun:test'
import { findCommand, getCommands } from './registry'

describe('/init command', () => {
  test('is a user-invocable builtin prompt command', () => {
    const cmd = findCommand('init', '/tmp/nonexistent-astraea-init-test')

    expect(cmd?.type).toBe('prompt')
    expect(cmd?.source).toBe('builtin')
    expect(cmd?.userInvocable).toBe(true)
    expect(cmd?.modelInvocable).toBe(false)
  })

  test('builds an Astraea AGENTS.md onboarding prompt', async () => {
    const cmd = findCommand('init', '/tmp/nonexistent-astraea-init-test')
    if (!cmd || cmd.type !== 'prompt') throw new Error('/init prompt command missing')

    const blocks = await cmd.getPrompt(undefined)
    const text = blocks.map(block => block.text).join('\n')

    expect(text).toContain('AGENTS.md')
    expect(text).toContain('AGENTS.local.md')
    expect(text).toContain('package.json')
    expect(text).toContain('README')
    expect(text).toContain('.cursor/rules')
    expect(text).toContain('.mcp.json')
    expect(text).toContain('Bun')
    expect(text).toContain('build, test, and lint commands')
    expect(text).toContain('Do not create CLAUDE.md')
  })

  test('keeps /init before user or project skills with the same name', () => {
    const initCommands = getCommands('/tmp/nonexistent-astraea-init-test')
      .filter(command => command.name === 'init')

    expect(initCommands).toHaveLength(1)
    expect(initCommands[0]?.source).toBe('builtin')
  })
})

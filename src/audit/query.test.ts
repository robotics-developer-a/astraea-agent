import { test, expect, describe } from 'bun:test'
import { parseAuditArgs, formatAuditTable } from './query.js'
import type { AuditRecord } from './types.js'

function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    ts: '2026-06-22T08:30:15.000Z',
    sessionId: 's1',
    tool: 'Bash',
    target: 'git push origin main',
    behavior: 'allow',
    reason: { type: 'rule', detail: 'git push:*' },
    mode: 'default',
    interactive: true,
    ...over,
  }
}

describe('parseAuditArgs', () => {
  test('empty → session scope, no filter', () => {
    expect(parseAuditArgs(undefined)).toEqual({ scope: 'session', filter: {} })
    expect(parseAuditArgs('')).toEqual({ scope: 'session', filter: {} })
  })

  test('--project → project scope', () => {
    expect(parseAuditArgs('--project').scope).toBe('project')
  })

  test('--deny / --allow → behavior filter', () => {
    expect(parseAuditArgs('--deny').filter.behavior).toBe('deny')
    expect(parseAuditArgs('--allow').filter.behavior).toBe('allow')
  })

  test('--reason <type> → reasonType filter', () => {
    expect(parseAuditArgs('--reason redline').filter.reasonType).toBe('redline')
  })

  test('combines flags', () => {
    const r = parseAuditArgs('--project --deny --reason fail-closed')
    expect(r.scope).toBe('project')
    expect(r.filter.behavior).toBe('deny')
    expect(r.filter.reasonType).toBe('fail-closed')
  })
})

describe('formatAuditTable', () => {
  test('empty → friendly no-records message', () => {
    const out = formatAuditTable([], 'session')
    expect(out.toLowerCase()).toContain('no permission decisions')
  })

  test('renders one allow row with ok marker, tool, reason type, target', () => {
    const out = formatAuditTable([rec()], 'session')
    expect(out).toContain('⟦ok⟧')
    expect(out).toContain('Bash')
    expect(out).toContain('rule')
    expect(out).toContain('git push origin main')
  })

  test('deny row uses err marker', () => {
    const out = formatAuditTable([rec({ behavior: 'deny', reason: { type: 'hard-block' } })], 'session')
    expect(out).toContain('⟦err⟧')
    expect(out).toContain('hard-block')
  })

  test('header reflects record count', () => {
    const out = formatAuditTable([rec(), rec({ behavior: 'deny' })], 'session')
    expect(out).toContain('2')
  })
})

import { test, expect, describe } from 'bun:test'
import stripAnsi from 'strip-ansi'
import { parseAuditArgs, formatAuditTable, DEFAULT_AUDIT_LIMIT } from './query.js'
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
  test('empty → session scope, no filter, default limit', () => {
    expect(parseAuditArgs(undefined)).toEqual({ scope: 'session', filter: {}, limit: DEFAULT_AUDIT_LIMIT })
    expect(parseAuditArgs('')).toEqual({ scope: 'session', filter: {}, limit: DEFAULT_AUDIT_LIMIT })
  })

  test('--all → no limit (null)', () => {
    expect(parseAuditArgs('--all').limit).toBeNull()
  })

  test('--limit N → custom limit; invalid ignored', () => {
    expect(parseAuditArgs('--limit 5').limit).toBe(5)
    expect(parseAuditArgs('--limit abc').limit).toBe(DEFAULT_AUDIT_LIMIT)
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
  // 固定宽度，避免依赖测试机真实终端列宽导致 target 被截断（width-adaptive 是特性）。
  const W = { width: 200 }

  test('empty → friendly no-records message', () => {
    const out = formatAuditTable([], 'session')
    expect(out.toLowerCase()).toContain('no permission decisions')
  })

  test('renders one allow row with ok marker, tool, reason type, mode, target', () => {
    const out = formatAuditTable([rec()], 'session', W)
    expect(out).toContain('⟦ok⟧')
    expect(out).toContain('Bash')
    expect(out).toContain('rule')
    expect(out).toContain('default') // mode 列现已展示
    expect(out).toContain('git push origin main')
  })

  test('deny row uses err marker', () => {
    const out = formatAuditTable([rec({ behavior: 'deny', reason: { type: 'hard-block' } })], 'session', W)
    expect(out).toContain('⟦err⟧')
    expect(out).toContain('hard-block')
  })

  test('header reflects record count', () => {
    const out = formatAuditTable([rec(), rec({ behavior: 'deny' })], 'session', W)
    expect(out).toContain('2')
  })

  test('long target ellipsized to fit width (no hard 60-char cut)', () => {
    const long = '/Users/x/' + 'a'.repeat(300)
    const out = formatAuditTable([rec({ target: long })], 'session', { width: 80 })
    expect(out).toContain('…')           // 截断了
    expect(out).not.toContain('aaaaaaaaaaaaaaaaaaaa'.repeat(3)) // 没整段铺出去
    // 每行宽度都不超过给定 width（去 ANSI 后按显示宽度算）。
    for (const line of out.split('\n')) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(80)
    }
  })

  test('pagination note shown when total exceeds shown', () => {
    const out = formatAuditTable([rec()], 'session', { total: 50, limit: 30, width: 120 })
    expect(out).toContain('50 decisions')
    expect(out.toLowerCase()).toContain('showing last 1')
    expect(out).toContain('--all')
  })
})

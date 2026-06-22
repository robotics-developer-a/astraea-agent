import { test, expect, describe, afterEach } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import {
  appendAuditLine,
  readAudit,
  filterAudit,
  recordDecision,
  setAuditSession,
  getAuditSession,
} from './record.js'
import type { AuditRecord } from './types.js'

function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    ts: '2026-06-22T00:00:00.000Z',
    sessionId: 's1',
    tool: 'Bash',
    target: 'git push',
    behavior: 'allow',
    reason: { type: 'rule', detail: 'git push:*' },
    mode: 'default',
    interactive: true,
    ...over,
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'astraea-audit-'))
afterEach(() => setAuditSession(null))

describe('audit append/read roundtrip', () => {
  test('appends one JSON line and reads it back', () => {
    const path = join(tmp, 'a.audit.jsonl')
    appendAuditLine(path, rec())
    const got = readAudit(path)
    expect(got).toHaveLength(1)
    expect(got[0]!.target).toBe('git push')
    expect(got[0]!.reason.type).toBe('rule')
  })

  test('multiple appends accumulate in order', () => {
    const path = join(tmp, 'b.audit.jsonl')
    appendAuditLine(path, rec({ target: 'one' }))
    appendAuditLine(path, rec({ target: 'two' }))
    const got = readAudit(path)
    expect(got.map((r) => r.target)).toEqual(['one', 'two'])
  })

  test('readAudit returns [] for missing file', () => {
    expect(readAudit(join(tmp, 'nope.audit.jsonl'))).toEqual([])
  })

  test('readAudit skips corrupt lines, keeps valid ones', () => {
    const path = join(tmp, 'c.audit.jsonl')
    appendAuditLine(path, rec({ target: 'good' }))
    require('node:fs').appendFileSync(path, 'not json\n')
    appendAuditLine(path, rec({ target: 'good2' }))
    expect(readAudit(path).map((r) => r.target)).toEqual(['good', 'good2'])
  })
})

describe('filterAudit', () => {
  const records = [
    rec({ behavior: 'allow', reason: { type: 'mode' } }),
    rec({ behavior: 'deny', reason: { type: 'rule' } }),
    rec({ behavior: 'deny', reason: { type: 'fail-closed' } }),
  ]

  test('filters by behavior', () => {
    expect(filterAudit(records, { behavior: 'deny' })).toHaveLength(2)
  })

  test('filters by reason type', () => {
    expect(filterAudit(records, { reasonType: 'fail-closed' })).toHaveLength(1)
  })

  test('combines behavior + reason type', () => {
    const r = filterAudit(records, { behavior: 'deny', reasonType: 'rule' })
    expect(r).toHaveLength(1)
    expect(r[0]!.reason.type).toBe('rule')
  })

  test('no filter returns all', () => {
    expect(filterAudit(records, {})).toHaveLength(3)
  })
})

describe('recordDecision fire-and-forget', () => {
  test('no-ops without an active session (no throw)', () => {
    setAuditSession(null)
    expect(() =>
      recordDecision({
        tool: 'Bash',
        target: 'ls',
        behavior: 'allow',
        reason: { type: 'mode' },
        mode: 'forge',
        interactive: false,
      }),
    ).not.toThrow()
  })

  test('setAuditSession / getAuditSession roundtrip', () => {
    setAuditSession('sess-xyz')
    expect(getAuditSession()).toBe('sess-xyz')
  })
})

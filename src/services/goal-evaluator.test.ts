import { test, expect } from 'bun:test'
import { parseCritiqueDecision, parseDecision, serializeTranscript, serializeEvidenceLedger } from './goal-evaluator'
import type { AssistantMessage, UserMessage } from '../types/message'
import type { ToolEvidenceRecord } from './evidence-registry'

// ── parseDecision ────────────────────────────────────────────────────────────

test('parses a clean JSON verdict', () => {
  const d = parseDecision('{"met": true, "reason": "tests passed"}')
  expect(d.met).toBe(true)
  expect(d.reason).toBe('tests passed')
})

test('parses JSON wrapped in code fences and prose', () => {
  const raw = 'Here is my verdict:\n```json\n{"met": false, "reason": "still 2 failures"}\n```'
  const d = parseDecision(raw)
  expect(d.met).toBe(false)
  expect(d.reason).toBe('still 2 failures')
})

test('supplies a default reason when reason is missing', () => {
  const d = parseDecision('{"met": true}')
  expect(d.met).toBe(true)
  expect(d.reason.length).toBeGreaterThan(0)
})

test('falls back conservatively to not-met on unparseable output', () => {
  const d = parseDecision('the model rambled without any json')
  expect(d.met).toBe(false)
  expect(d.reason).toContain('non-JSON')
})

test('heuristic detects an affirmative non-JSON answer', () => {
  const d = parseDecision('Yes, the condition is satisfied.')
  expect(d.met).toBe(true)
})

test('heuristic treats "not satisfied" as not met', () => {
  const d = parseDecision('No, this is not satisfied yet.')
  expect(d.met).toBe(false)
})

// ── serializeTranscript ──────────────────────────────────────────────────────

test('serializes user text, assistant text, tool calls and tool results', () => {
  const messages: (UserMessage | AssistantMessage)[] = [
    { role: 'user', content: 'run the tests' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Running tests now' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'All tests passed, exit 0' }],
    },
  ]
  const out = serializeTranscript(messages)
  expect(out).toContain('USER: run the tests')
  expect(out).toContain('ASSISTANT: Running tests now')
  expect(out).toContain('ASSISTANT_TOOL_CALL: Bash')
  expect(out).toContain('TOOL_RESULT: All tests passed, exit 0')
})

test('marks error tool results distinctly', () => {
  const messages: (UserMessage | AssistantMessage)[] = [
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }],
    },
  ]
  expect(serializeTranscript(messages)).toContain('TOOL_RESULT(error): boom')
})

test('truncates very long transcripts but keeps the tail', () => {
  const big = 'A'.repeat(40_000)
  const messages: (UserMessage | AssistantMessage)[] = [
    { role: 'user', content: big },
    { role: 'assistant', content: [{ type: 'text', text: 'FINAL_MARKER' }] },
  ]
  const out = serializeTranscript(messages)
  expect(out.length).toBeLessThan(20_000)
  expect(out).toContain('FINAL_MARKER')
  expect(out).toContain('truncated')
})

// ── serializeEvidenceLedger（改动①）─────────────────────────────────────────

test('empty ledger serializes to empty string', () => {
  expect(serializeEvidenceLedger([])).toBe('')
})

test('ledger keeps the tool name and full output in chronological order', () => {
  const records: ToolEvidenceRecord[] = [
    { id: 't1', tool: 'Bash', output: 'npm test → exit 0', recordedAt: '2026-06-30T00:00:00Z' },
    { id: 't2', tool: 'Bash', output: 'tsc → no errors', recordedAt: '2026-06-30T00:01:00Z' },
  ]
  const out = serializeEvidenceLedger(records)
  expect(out).toContain('[Bash]')
  expect(out).toContain('npm test → exit 0')
  expect(out).toContain('tsc → no errors')
  // 时间顺序：先 exit 0，后 tsc
  expect(out.indexOf('exit 0')).toBeLessThan(out.indexOf('tsc'))
})

test('ledger preserves the tail of an oversized single record', () => {
  const big = 'X'.repeat(5_000) + 'EXIT_CODE_0'
  const out = serializeEvidenceLedger([{ id: 't1', tool: 'Bash', output: big }])
  expect(out).toContain('EXIT_CODE_0')
  expect(out).toContain('head truncated')
  expect(out.length).toBeLessThan(3_000)
})

test('ledger caps total size but keeps the most recent records', () => {
  const records: ToolEvidenceRecord[] = Array.from({ length: 50 }, (_, i) => ({
    id: `t${i}`,
    tool: 'Bash',
    output: 'Y'.repeat(1_000) + ` RECORD_${i}`,
  }))
  const out = serializeEvidenceLedger(records)
  expect(out.length).toBeLessThanOrEqual(12_000 + 200)
  // 最近的记录必须保留
  expect(out).toContain('RECORD_49')
  // 最早的记录被预算挤掉
  expect(out).not.toContain('RECORD_0 ')
})

// ── parseCritiqueDecision ────────────────────────────────────────────────────

test('critique parser accepts clean evidence', () => {
  const d = parseCritiqueDecision('{"pass":true,"reason":"Evidence is sufficient.","findings":[]}')
  expect(d.pass).toBe(true)
  expect(d.reason).toBe('Evidence is sufficient.')
  expect(d.findings).toEqual([])
})

test('critique parser preserves evidence, coverage, and goalpost findings', () => {
  const raw = JSON.stringify({
    pass: false,
    reason: 'Verification is not strong enough.',
    findings: [
      { kind: 'insufficient_evidence', detail: 'No command output proves the file renders.' },
      { kind: 'risk_coverage_gap', detail: 'Tests miss the error path.' },
      { kind: 'goalpost_shift', detail: 'The failing assertion was removed.' },
    ],
  })
  const d = parseCritiqueDecision(raw)
  expect(d.pass).toBe(false)
  expect(d.findings.map(f => f.kind)).toEqual([
    'insufficient_evidence',
    'risk_coverage_gap',
    'goalpost_shift',
  ])
})

test('critique parser fails closed on malformed output', () => {
  const d = parseCritiqueDecision('looks fine to me')
  expect(d.pass).toBe(false)
  expect(d.reason).toContain('non-JSON')
})

import { expect, test } from 'bun:test'
import {
  buildCommitmentDirective,
  parseCompletionAssessment,
} from './completion-guard'

test('parses an unfulfilled action commitment verdict', () => {
  expect(parseCompletionAssessment(JSON.stringify({
    verdict: 'unfulfilled_commitment',
    reason: 'Promised actions have no tool calls.',
  }))).toEqual({
    verdict: 'unfulfilled_commitment',
    reason: 'Promised actions have no tool calls.',
  })
})

test('preserves safe terminal verdicts', () => {
  for (const verdict of ['complete', 'waiting_for_user', 'blocked'] as const) {
    expect(parseCompletionAssessment(JSON.stringify({ verdict, reason: verdict }))).toEqual({
      verdict,
      reason: verdict,
    })
  }
})

test('invalid classifier output fails open instead of trapping the turn', () => {
  const assessment = parseCompletionAssessment('not json')
  expect(assessment.verdict).toBe('complete')
  expect(assessment.reason).toContain('invalid output')
})

test('continuation directive requires action rather than another plan recital', () => {
  const directive = buildCommitmentDirective('No tool was called.')
  expect(directive).toContain('Do not describe the plan again')
  expect(directive).toContain('immediately perform the promised actions with tools')
  expect(directive).toContain('No tool was called.')
})

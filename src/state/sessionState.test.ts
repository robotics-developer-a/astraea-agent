import { test, expect } from 'bun:test'
import { getInputTokens, recordInputTokens } from './contextTokens'
import { getLastAssistantTs, recordAssistantTs } from './microcompactState'
import { getActiveGoal, setGoal } from './goalState'

test('resetSessionStates clears contextTokens, microcompactState and goalState', async () => {
  // Must await dynamic import to side-step circular-import issues
  const { resetSessionStates } = await import('./sessionState')

  // Arrange: set each state to a non-default value
  recordInputTokens(99999)
  recordAssistantTs()
  setGoal('test condition')

  expect(getInputTokens()).toBe(99999)
  expect(getLastAssistantTs()).not.toBeNull()
  expect(getActiveGoal()).not.toBeNull()

  // Act
  resetSessionStates()

  // Assert
  expect(getInputTokens()).toBeNull()
  expect(getLastAssistantTs()).toBeNull()
  expect(getActiveGoal()).toBeNull()
})

test('markSessionStale marks contextTokens as unknown', async () => {
  const { markSessionStale } = await import('./sessionState')
  const { markTokensUnknown } = await import('./contextTokens')

  recordInputTokens(50000)
  expect(getInputTokens()).toBe(50000)

  markSessionStale()

  // markSessionStale calls markTokensUnknown internally
  // We verify the effect is the same as calling markTokensUnknown directly
  expect(getInputTokens()).toBeNull()
})

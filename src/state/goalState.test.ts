import { test, expect, beforeEach } from 'bun:test'
import {
  setGoal,
  getActiveGoal,
  isGoalActive,
  clearGoal,
  recordGoalEvaluation,
  markGoalAchieved,
  getLastAchieved,
  isGoalStalled,
  GOAL_STALL_WINDOW,
  GOAL_MAX_CONDITION_LENGTH,
} from './goalState'

beforeEach(() => {
  clearGoal()
})

test('setGoal activates a goal with zeroed counters', () => {
  const g = setGoal('all tests pass')
  expect(g).not.toBeNull()
  expect(isGoalActive()).toBe(true)
  expect(getActiveGoal()?.condition).toBe('all tests pass')
  expect(getActiveGoal()?.turnsEvaluated).toBe(0)
  expect(getActiveGoal()?.tokenSpend).toBe(0)
  expect(getActiveGoal()?.lastReason).toBeNull()
})

test('setGoal trims and rejects empty conditions', () => {
  expect(setGoal('   ')).toBeNull()
  expect(isGoalActive()).toBe(false)
  setGoal('  npm test exits 0  ')
  expect(getActiveGoal()?.condition).toBe('npm test exits 0')
})

test('setGoal caps condition length at GOAL_MAX_CONDITION_LENGTH', () => {
  const long = 'x'.repeat(GOAL_MAX_CONDITION_LENGTH + 500)
  setGoal(long)
  expect(getActiveGoal()?.condition.length).toBe(GOAL_MAX_CONDITION_LENGTH)
})

test('setGoal replaces an existing active goal', () => {
  setGoal('first')
  setGoal('second')
  expect(getActiveGoal()?.condition).toBe('second')
})

test('recordGoalEvaluation accumulates turns, reason and token spend', () => {
  setGoal('cond')
  recordGoalEvaluation('not yet', 1200)
  recordGoalEvaluation('still not', 2500)
  const g = getActiveGoal()
  expect(g?.turnsEvaluated).toBe(2)
  expect(g?.lastReason).toBe('still not')
  expect(g?.tokenSpend).toBe(2500)
})

test('recordGoalEvaluation is a no-op when no goal is active', () => {
  expect(() => recordGoalEvaluation('x', 10)).not.toThrow()
  expect(isGoalActive()).toBe(false)
})

test('markGoalAchieved moves active goal into the achieved record and clears it', () => {
  setGoal('build green')
  recordGoalEvaluation('almost', 500)
  recordGoalEvaluation('done', 900)
  const achieved = markGoalAchieved('build exited 0')
  expect(achieved?.condition).toBe('build green')
  expect(achieved?.turns).toBe(2)
  expect(achieved?.tokenSpend).toBe(900)
  expect(achieved?.reason).toBe('build exited 0')
  expect(isGoalActive()).toBe(false)
  expect(getLastAchieved()?.condition).toBe('build green')
})

test('clearGoal returns the cleared goal and deactivates', () => {
  setGoal('cond')
  const cleared = clearGoal()
  expect(cleared?.condition).toBe('cond')
  expect(isGoalActive()).toBe(false)
  expect(clearGoal()).toBeNull()
})

test('isGoalStalled is false before the window fills', () => {
  setGoal('cond')
  expect(isGoalStalled()).toBe(false)
  recordGoalEvaluation('still 2 tests failing', 100)
  recordGoalEvaluation('still 1 test failing', 200)
  // 仅 2 条 < 窗口 3 → 不判停滞
  expect(GOAL_STALL_WINDOW).toBe(3)
  expect(isGoalStalled()).toBe(false)
})

test('isGoalStalled triggers when recent reasons are the same modulo numbers', () => {
  setGoal('cond')
  recordGoalEvaluation('still 5 tests failing', 100)
  recordGoalEvaluation('still 5 tests failing', 200)
  recordGoalEvaluation('still 3 tests failing', 300) // 去数字后归一化相等
  expect(isGoalStalled()).toBe(true)
})

test('isGoalStalled stays false when the agent is making varied progress', () => {
  setGoal('cond')
  recordGoalEvaluation('5 tests failing', 100)
  recordGoalEvaluation('compile error in foo.ts', 200)
  recordGoalEvaluation('lint warnings remain', 300)
  expect(isGoalStalled()).toBe(false)
})

test('isGoalStalled is false when no goal is active', () => {
  expect(isGoalStalled()).toBe(false)
})

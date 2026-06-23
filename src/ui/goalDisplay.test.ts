import { test, expect } from 'bun:test'
import { summarizeGoalConditionForDisplay } from './GoalPanel'

test('summarizeGoalConditionForDisplay keeps long pasted goals to one sentence', () => {
  const condition = [
    '修复 /goal 面板显示 pasted placeholder 的问题。',
    '需要保留完整目标给 evaluator 使用。',
    '还要补测试并更新 changelog。',
  ].join('\n')

  const summary = summarizeGoalConditionForDisplay(condition, 80)

  expect(summary).toBe('修复 /goal 面板显示 pasted placeholder 的问题。')
  expect(summary).not.toContain('\n')
})

import { expect, mock, test } from 'bun:test'

let capturedOptions: unknown

mock.module('../api/query-model', () => ({
  querySmallModel: async (
    _prompt: string,
    _signal?: AbortSignal,
    _systemPrompt?: string,
    options?: unknown,
  ) => {
    capturedOptions = options
    return '{"met":true,"reason":"ok"}'
  },
}))

test('evaluateGoal requests provider-neutral structured JSON output', async () => {
  const { evaluateGoal } = await import('./goal-evaluator')

  const decision = await evaluateGoal('tests pass', 'TOOL_RESULT: exit 0')

  expect(decision.met).toBe(true)
  expect(capturedOptions).toEqual({ structuredResponse: 'json' })
})

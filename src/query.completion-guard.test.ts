import { expect, mock, test } from 'bun:test'
import type { StreamEvent } from './types/message'
import { config } from './config'

let streamCalls = 0
let assessmentCalls = 0

async function* mockedStream(): AsyncGenerator<StreamEvent> {
  streamCalls++
  if (streamCalls === 1) {
    yield { type: 'text', text: '开始更新 CHANGELOG、提交、打标签、推送。' }
  } else {
    yield { type: 'text', text: '实际执行完成。' }
  }
  yield {
    type: 'message_stop',
    usage: { input_tokens: 1, output_tokens: 1 },
    stopReason: 'end_turn',
  }
}

mock.module('./api/stream', () => ({ streamMessage: mockedStream }))
mock.module('./api/anthropic', () => ({ streamMessageAnthropic: mockedStream }))
test('a tool-free action promise is continued instead of returned as done', async () => {
  config.provider = 'anthropic'
  streamCalls = 0
  assessmentCalls = 0

  const { query } = await import('./query')
  const events = []
  for await (const event of query(
    [{ role: 'user', content: '请提交并推送 v0.10.16' }],
    [],
    {
      autocompact: true,
      maxTurns: 3,
      cwd: '/tmp/astraea-completion-guard-test',
      completionAssessor: async () => {
        assessmentCalls++
        return {
          verdict: 'unfulfilled_commitment',
          reason: 'The assistant promised repository actions without calling a tool.',
        }
      },
    },
  )) {
    events.push(event)
  }

  expect(assessmentCalls).toBe(1)
  expect(streamCalls).toBe(2)
  expect(events.filter(event => event.type === 'turn_start')).toHaveLength(2)
})

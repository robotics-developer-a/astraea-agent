import { afterEach, expect, mock, test } from 'bun:test'
import type { AssistantMessage, UserMessage } from './types/message'
import type { StreamEvent } from './types/message'
import { config } from './config'

let capturedMessages: (UserMessage | AssistantMessage)[] = []

async function* captureStream(
  messages: (UserMessage | AssistantMessage)[],
): AsyncGenerator<StreamEvent> {
  capturedMessages = messages
  yield { type: 'text', text: 'ok' }
  yield {
    type: 'message_stop',
    usage: { input_tokens: 1, output_tokens: 1 },
    stopReason: 'end_turn',
  }
}

mock.module('./api/stream', () => ({ streamMessage: captureStream }))
mock.module('./context/session-preamble', () => ({
  getSystemContext: async () => ({}),
  getUserContext: async () => ({ claudeMd: 'project rules', currentDate: '2026-06-24' }),
  appendSystemContext: (system: string) => system,
  prependUserContext: () => [{
    role: 'user',
    content: '<system-reminder>\nproject rules\n</system-reminder>\n\n<system-reminder>\nToday\'s date is 2026-06-24.\n</system-reminder>',
  }],
}))
mock.module('./memory/inject', () => ({
  loadMemoryInstructions: () => '# auto memory\nstable memory rules',
  loadMemoryIndex: async () => null,
  buildRelevantMemoriesReminder: async () => null,
}))

afterEach(() => {
  capturedMessages = []
})

test('DeepSeek cache-friendly requests keep volatile user reminders after conversation history', async () => {
  config.provider = 'deepseek'
  const { query } = await import('./query')

  for await (const event of query(
    [{ role: 'user', content: 'preserve me as the stable conversation prefix' }],
    [],
    { maxTurns: 1 },
  )) {
    if (event.type === 'message_stop') break
  }

  expect(capturedMessages[0]).toMatchObject({
    role: 'user',
    content: 'preserve me as the stable conversation prefix',
  })
  expect(capturedMessages.at(-1)?.role).toBe('user')
  expect(String(capturedMessages.at(-1)?.content)).toContain("Today's date is")
})

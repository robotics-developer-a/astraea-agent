import { afterEach, expect, mock, test } from 'bun:test'
import type { StreamEvent } from './types/message'
import { TodoWriteTool } from './tools/TodoWriteTool'
import { TaskListTool } from './tools/TaskListTool'
import { clearTodos, getTodos, setTodos } from './services/todo-state'
import { clearToolEvidence } from './services/evidence-registry'
import { config } from './config'

const NS = 'query-todo-evidence-test'

let streamCalls = 0

async function* mockedToolBatch(): AsyncGenerator<StreamEvent> {
  streamCalls++
  if (streamCalls === 1) {
    yield { type: 'tool_use', id: 'toolu_vrbx_read_1', name: 'TaskList', input: {} }
    yield {
      type: 'tool_use',
      id: 'toolu_vrbx_todo_1',
      name: 'TodoWrite',
      input: {
        todos: [{
          id: '1',
          content: 'Finish evidence-gated task',
          status: 'completed',
          acceptanceCriteria: ['Evidence probe succeeded'],
          verificationCommand: 'TaskList',
          evidenceRefs: ['toolu_vrbx_read_1'],
        }],
      },
    }
    yield {
      type: 'message_stop',
      usage: { input_tokens: 1, output_tokens: 1 },
      stopReason: 'tool_use',
    }
    return
  }

  yield { type: 'text', text: 'done' }
  yield {
    type: 'message_stop',
    usage: { input_tokens: 1, output_tokens: 1 },
    stopReason: 'end_turn',
  }
}

mock.module('./api/stream', () => ({ streamMessage: mockedToolBatch }))
mock.module('./api/anthropic', () => ({ streamMessageAnthropic: mockedToolBatch }))

afterEach(() => {
  streamCalls = 0
  clearTodos(NS)
  clearToolEvidence(NS)
})

test('TodoWrite can complete with evidence from an earlier tool in the same assistant tool batch', async () => {
  config.provider = 'anthropic'
  setTodos([{
    id: '1',
    content: 'Finish evidence-gated task',
    status: 'in_progress',
    acceptanceCriteria: ['Evidence probe succeeded'],
    verificationCommand: 'TaskList',
  }], NS)

  const { query } = await import('./query')
  const events = []
  for await (const event of query(
    [{ role: 'user', content: 'finish the task' }],
    [TaskListTool, TodoWriteTool],
    { agentId: NS, maxTurns: 2 },
  )) {
    events.push(event)
    if (event.type === 'tool_result' && event.name === 'TodoWrite') break
  }

  const todoResult = events.find(
    event => event.type === 'tool_result' && event.name === 'TodoWrite',
  )
  expect(todoResult).toMatchObject({ isError: false })
  expect(getTodos(NS)[0]?.status).toBe('completed')
  expect(getTodos(NS)[0]?.evidenceRefs).toEqual(['toolu_vrbx_read_1'])
})

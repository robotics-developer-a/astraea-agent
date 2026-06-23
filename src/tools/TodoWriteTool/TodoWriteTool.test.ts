import { afterEach, expect, test } from 'bun:test'
import { TodoWriteTool } from './index'
import { clearTodos, getTodos } from '../../services/todo-state'
import { clearToolEvidence, recordToolEvidence } from '../../services/evidence-registry'
import type { ToolContext } from '../Tool'

const NS = 'todo-gate-test'
const ctx: ToolContext = { mode: 'default', agentId: NS, isInteractive: false }

const baseTodo = {
  id: '1',
  content: 'Implement login provider reuse',
  status: 'in_progress',
  acceptanceCriteria: ['Login shows reuse API key option when provider key exists'],
  verificationCommand: 'bun test src/ui/LoginWizard.test.tsx',
}

afterEach(() => {
  clearTodos(NS)
  clearToolEvidence(NS)
})

test('rejects todos without acceptance criteria and verification command', async () => {
  const result = await TodoWriteTool.call({
    todos: [{
      id: '1',
      content: 'Implement login provider reuse',
      status: 'in_progress',
    }],
  }, ctx)

  expect(result.isError).toBe(true)
  expect(result.output).toContain('acceptanceCriteria')
  expect(result.output).toContain('verificationCommand')
  expect(getTodos(NS)).toEqual([])
})

test('rejects creating a todo directly as completed', async () => {
  recordToolEvidence(NS, {
    id: 'tool-1',
    tool: 'Bash',
    output: 'bun test passed, exit 0',
    isError: false,
  })

  const result = await TodoWriteTool.call({
    todos: [{
      ...baseTodo,
      status: 'completed',
      evidenceRefs: ['tool-1'],
    }],
  }, ctx)

  expect(result.isError).toBe(true)
  expect(result.output).toContain('in_progress')
  expect(getTodos(NS)).toEqual([])
})

test('rejects completed todos without evidence refs', async () => {
  await TodoWriteTool.call({ todos: [baseTodo] }, ctx)

  const result = await TodoWriteTool.call({
    todos: [{
      ...baseTodo,
      status: 'completed',
    }],
  }, ctx)

  expect(result.isError).toBe(true)
  expect(result.output).toContain('evidenceRefs')
})

test('rejects completed todos that reference unknown evidence', async () => {
  await TodoWriteTool.call({ todos: [baseTodo] }, ctx)

  const result = await TodoWriteTool.call({
    todos: [{
      ...baseTodo,
      status: 'completed',
      evidenceRefs: ['fake-tool-id'],
    }],
  }, ctx)

  expect(result.isError).toBe(true)
  expect(result.output).toContain('Unknown evidenceRefs')
})

test('accepts completed todos only when they cite successful tool evidence', async () => {
  await TodoWriteTool.call({ todos: [baseTodo] }, ctx)
  recordToolEvidence(NS, {
    id: 'tool-1',
    tool: 'Bash',
    output: 'bun test passed, exit 0',
    isError: false,
  })

  const result = await TodoWriteTool.call({
    todos: [{
      ...baseTodo,
      status: 'completed',
      evidenceRefs: ['tool-1'],
    }],
  }, ctx)

  expect(result.isError).toBeUndefined()
  const [stored] = getTodos(NS)
  expect(stored?.acceptanceCriteria).toEqual(baseTodo.acceptanceCriteria)
  expect(stored?.verificationCommand).toBe(baseTodo.verificationCommand)
  expect(stored?.evidenceRefs).toEqual(['tool-1'])
  expect(stored?.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})

test('does not allow failed tool results to become completion evidence', async () => {
  await TodoWriteTool.call({ todos: [baseTodo] }, ctx)
  recordToolEvidence(NS, {
    id: 'tool-1',
    tool: 'Bash',
    output: 'bun test failed, exit 1',
    isError: true,
  })

  const result = await TodoWriteTool.call({
    todos: [{
      ...baseTodo,
      status: 'completed',
      evidenceRefs: ['tool-1'],
    }],
  }, ctx)

  expect(result.isError).toBe(true)
  expect(result.output).toContain('Unknown evidenceRefs')
})

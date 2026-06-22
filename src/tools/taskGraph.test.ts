import { beforeEach, describe, expect, test } from 'bun:test'
import { clearAllTasks } from '../services/agent-state'
import { TaskCreateTool } from './TaskCreateTool'
import { TaskGetTool } from './TaskGetTool'
import { TaskUpdateTool } from './TaskUpdateTool'

const ctx = { mode: 'default' as const }

beforeEach(() => clearAllTasks())

async function createTask(
  subject: string,
  dependencies: string[] = [],
  acceptanceCriteria = ['Expected result is verified'],
) {
  const result = await TaskCreateTool.call({ subject, dependencies, acceptanceCriteria }, ctx)
  expect(result.isError).toBeFalsy()
  return JSON.parse(result.output) as {
    taskId: string
    status: string
    acceptanceCriteria: Array<{ id: string; description: string }>
  }
}

async function getTask(taskId: string) {
  const result = await TaskGetTool.call({ taskId }, ctx)
  expect(result.isError).toBeFalsy()
  return JSON.parse(result.output) as Record<string, any>
}

function proof(criterionId = 'criterion-1') {
  return {
    criterionId,
    claim: 'The expected result was observed.',
    source: 'bun test src/tools/taskGraph.test.ts exited 0',
    confidence: 'high',
    assumptions: ['The test exercises the production task state.'],
  }
}

describe('task graph dependencies', () => {
  test('a dependent task stays blocked until its dependency is completed with evidence', async () => {
    const foundation = await createTask('Build foundation')
    const walls = await createTask('Build walls', [foundation.taskId])
    expect(walls.status).toBe('blocked')

    const earlyStart = await TaskUpdateTool.call(
      { taskId: walls.taskId, status: 'in_progress' },
      ctx,
    )
    expect(earlyStart.isError).toBe(true)
    expect(earlyStart.output).toContain('dependency')

    await TaskUpdateTool.call({ taskId: foundation.taskId, status: 'in_progress' }, ctx)
    const unsupportedCompletion = await TaskUpdateTool.call(
      { taskId: foundation.taskId, status: 'completed' },
      ctx,
    )
    expect(unsupportedCompletion.isError).toBe(true)
    expect(unsupportedCompletion.output).toContain('criterion-1')

    const completion = await TaskUpdateTool.call(
      { taskId: foundation.taskId, status: 'completed', evidence: [proof()] },
      ctx,
    )
    expect(completion.isError).toBeFalsy()
    expect((await getTask(walls.taskId)).status).toBe('pending')
  })

  test('invalidating upstream evidence invalidates descendants but preserves independent tasks', async () => {
    const upstream = await createTask('Verify API contract')
    await TaskUpdateTool.call({ taskId: upstream.taskId, status: 'in_progress' }, ctx)
    await TaskUpdateTool.call({ taskId: upstream.taskId, status: 'completed', evidence: [proof()] }, ctx)

    const downstream = await createTask('Generate client', [upstream.taskId])
    await TaskUpdateTool.call({ taskId: downstream.taskId, status: 'in_progress' }, ctx)
    await TaskUpdateTool.call({ taskId: downstream.taskId, status: 'completed', evidence: [proof()] }, ctx)

    const independent = await createTask('Update README')
    await TaskUpdateTool.call({ taskId: independent.taskId, status: 'in_progress' }, ctx)
    await TaskUpdateTool.call({ taskId: independent.taskId, status: 'completed', evidence: [proof()] }, ctx)

    const invalidation = await TaskUpdateTool.call(
      { taskId: upstream.taskId, status: 'invalidated', notes: 'Provider documentation changed.' },
      ctx,
    )
    expect(invalidation.isError).toBeFalsy()
    expect((await getTask(downstream.taskId)).status).toBe('invalidated')
    expect((await getTask(independent.taskId)).status).toBe('completed')
  })

  test('dynamic dependency changes reject cycles', async () => {
    const first = await createTask('First')
    const second = await createTask('Second', [first.taskId])

    const result = await TaskUpdateTool.call(
      { taskId: first.taskId, status: 'in_progress', dependencies: [second.taskId] },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('cycle')
  })

  test('can revise dependencies without forcing a status transition', async () => {
    const first = await createTask('First')
    const prerequisite = await createTask('New prerequisite')

    const result = await TaskUpdateTool.call(
      { taskId: first.taskId, dependencies: [prerequisite.taskId] },
      ctx,
    )

    expect(result.isError).toBeFalsy()
    expect((await getTask(first.taskId)).status).toBe('blocked')
  })
})

describe('task evidence', () => {
  test('stores claim provenance confidence and assumptions with the criterion', async () => {
    const task = await createTask('Run verification')
    await TaskUpdateTool.call({ taskId: task.taskId, status: 'in_progress' }, ctx)
    await TaskUpdateTool.call({ taskId: task.taskId, status: 'completed', evidence: [proof()] }, ctx)

    const stored = await getTask(task.taskId)
    expect(stored.evidence).toEqual([
      expect.objectContaining({
        criterionId: 'criterion-1',
        claim: 'The expected result was observed.',
        source: 'bun test src/tools/taskGraph.test.ts exited 0',
        confidence: 'high',
        assumptions: ['The test exercises the production task state.'],
      }),
    ])
  })
})

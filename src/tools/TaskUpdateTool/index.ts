// TaskUpdateTool — 更新 TaskRecord 的进度状态
// 仅适用于 TaskCreateTool 创建的 task- 记录，不能用于 Agent 任务

import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult } from '../Tool.js'
import { getState, setState } from '../../services/agent-state.js'
import type { TaskEvidence, TaskRecordState, TaskRecordStatus } from '../../services/agent-state.js'
import {
  incompleteDependencies,
  mergeEvidence,
  missingEvidence,
  normalizeCriteria,
  reconcileTaskGraph,
  validateDependencies,
} from '../../services/task-graph.js'

export const TaskUpdateTool = buildTool({
  name: 'TaskUpdate',
  description: `Update the status of a task record created by TaskCreateTool.

Valid transitions:
  pending | blocked → in_progress → completed | failed
  completed → invalidated
  failed | invalidated → in_progress (retry / repair)

Call this to:
- Mark a task as started before beginning work
- Mark a task completed immediately when done (do not batch completions)
- Mark a task failed if it cannot be completed

Note: This tool operates on TaskRecord items (task- prefix), not Agent tasks (a prefix).
Agent task status is updated automatically via their execution lifecycle.`,
  isReadOnly: () => false,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The taskId returned by TaskCreateTool (starts with "task-").',
      },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed', 'failed', 'invalidated'],
        description: 'Optional new status. Omit when only revising dependencies or acceptance criteria.',
      },
      notes: {
        type: 'string',
        description: 'Optional notes to attach to this status update.',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional replacement dependency list. Cycles are rejected.',
      },
      acceptanceCriteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional replacement criteria. Replacing them clears stale evidence.',
      },
      evidence: {
        type: 'array',
        description: 'Evidence proving criteria: criterionId, claim, source, confidence, assumptions.',
        items: {
          type: 'object',
          properties: {
            criterionId: { type: 'string', description: 'Which acceptance criterion this evidence proves (its id from the task record).' },
            claim: { type: 'string', description: 'What this evidence demonstrates, in one sentence.' },
            source: { type: 'string', description: 'Where the proof comes from: a tool result id, command output, or file path.' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How directly the source proves the claim.' },
            assumptions: { type: 'array', items: { type: 'string' }, description: 'Unverified assumptions this evidence relies on; empty array if none.' },
          },
          required: ['criterionId', 'claim', 'source', 'confidence', 'assumptions'],
        },
      },
    },
    required: ['taskId'],
  },

  async call(input, _ctx: import("../Tool.js").ToolContext): Promise<ToolCallResult> {
    const taskId = input['taskId'] as string
    const requestedStatus = input['status'] as TaskRecordStatus | undefined

    const task = getState().tasks[taskId]
    if (!task) return { output: `Task "${taskId}" not found.`, isError: true }
    if (task.kind !== 'task') {
      return {
        output: `"${taskId}" is an agent task (kind=${task.kind}). Use TaskStop to cancel agents.`,
        isError: true,
      }
    }
    const status = requestedStatus ?? task.status

    const dependencies = input['dependencies'] === undefined
      ? task.dependencies
      : input['dependencies'] as string[]
    const dependencyError = validateDependencies(getState().tasks, taskId, dependencies)
    if (dependencyError) return { output: dependencyError, isError: true }

    const criteriaChanged = input['acceptanceCriteria'] !== undefined
    const acceptanceCriteria = criteriaChanged
      ? normalizeCriteria(input['acceptanceCriteria'] as string[])
      : task.acceptanceCriteria
    if (acceptanceCriteria.length === 0) {
      return { output: 'At least one acceptance criterion is required.', isError: true }
    }

    const rawEvidence = (input['evidence'] as Array<Record<string, unknown>> | undefined) ?? []
    const incomingEvidence: TaskEvidence[] = []
    for (const item of rawEvidence) {
      const criterionId = String(item['criterionId'] ?? '')
      const confidence = item['confidence']
      if (!acceptanceCriteria.some(criterion => criterion.id === criterionId)) {
        return { output: `Unknown acceptance criterion "${criterionId}".`, isError: true }
      }
      if (!['low', 'medium', 'high'].includes(String(confidence))) {
        return { output: `Invalid confidence for "${criterionId}".`, isError: true }
      }
      const claim = String(item['claim'] ?? '').trim()
      const source = String(item['source'] ?? '').trim()
      const assumptions = Array.isArray(item['assumptions'])
        ? item['assumptions'].map(String).map(value => value.trim()).filter(Boolean)
        : []
      if (!claim || !source) {
        return { output: `Evidence for "${criterionId}" requires a claim and source.`, isError: true }
      }
      incomingEvidence.push({
        criterionId,
        claim,
        source,
        confidence: confidence as TaskEvidence['confidence'],
        assumptions,
        recordedAt: new Date(),
      })
    }

    const evidence = mergeEvidence(criteriaChanged ? [] : task.evidence, incomingEvidence)
    const candidate: TaskRecordState = {
      ...task,
      dependencies,
      acceptanceCriteria,
      evidence,
      notes: input['notes'] ? [...task.notes, String(input['notes'])] : task.notes,
      updatedAt: new Date(),
    }
    const graphWithCandidate = { ...getState().tasks, [taskId]: candidate }

    if (status === 'in_progress' && incompleteDependencies(graphWithCandidate, candidate).length > 0) {
      return { output: 'Task cannot start while a dependency is incomplete.', isError: true }
    }
    if (status === 'completed') {
      const missing = missingEvidence(acceptanceCriteria, evidence)
      if (missing.length > 0) {
        return { output: `Cannot complete task; missing evidence for: ${missing.join(', ')}.`, isError: true }
      }
    }

    const validTransition =
      task.status === status ||
      (['pending', 'blocked'].includes(task.status) && status === 'in_progress') ||
      (task.status === 'in_progress' && ['completed', 'failed'].includes(status)) ||
      (task.status === 'completed' && status === 'invalidated') ||
      (['failed', 'invalidated'].includes(task.status) && status === 'in_progress')
    if (!validTransition) {
      return {
        output: `Invalid task transition: ${task.status} → ${status}.`,
        isError: true,
      }
    }

    setState(prev => {
      const updated = { ...candidate, status, updatedAt: new Date() }
      return { ...prev, tasks: reconcileTaskGraph({ ...prev.tasks, [taskId]: updated }) }
    })

    const stored = getState().tasks[taskId] as TaskRecordState

    return {
      output: JSON.stringify({ taskId, status: stored.status, updated: true }),
    }
  },
})

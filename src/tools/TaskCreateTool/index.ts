// TaskCreateTool — 单条任务创建器
// 创建一个可追踪的结构化工作项，返回 taskId 供后续工具引用
// 注意：这里的 Task 是 TaskRecord（进度追踪），不是子 Agent（见 AgentTool）

import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult } from '../Tool.js'
import { generateTaskId, setState, getState } from '../../services/agent-state.js'
import type { TaskRecordState } from '../../services/agent-state.js'
import { normalizeCriteria, reconcileTaskGraph, validateDependencies } from '../../services/task-graph.js'

export const TaskCreateTool = buildTool({
  name: 'TaskCreate',
  description: `Create a trackable task record to make your work observable to the user.

Use to:
- Declare a complex multi-step piece of work before starting it
- Give the user visibility into what you're doing and its progress
- Enable external systems (hooks) to respond to task lifecycle events

Returns a taskId. Use TaskUpdate to advance its status, TaskGet to query it.
This is different from Agent — TaskCreate is a progress-tracking record, not an AI sub-agent.`,
  isReadOnly: () => false,
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Short title for this task (shown in status UI).',
      },
      description: {
        type: 'string',
        description: 'Optional longer description of what this task involves.',
      },
      status: {
        type: 'string',
        enum: ['pending'],
        description: 'Initial status. Dependencies determine whether it becomes blocked.',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that must be completed before this task can start.',
      },
      acceptanceCriteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete, independently checkable conditions required before completion.',
      },
    },
    required: ['subject', 'acceptanceCriteria'],
  },

  async call(input, _ctx: import("../Tool.js").ToolContext): Promise<ToolCallResult> {
    const subject = input['subject'] as string
    const description = input['description'] as string | undefined
    const dependencies = (input['dependencies'] as string[] | undefined) ?? []
    const acceptanceCriteria = normalizeCriteria((input['acceptanceCriteria'] as string[] | undefined) ?? [])

    if (!subject?.trim()) return { output: 'Task subject is required.', isError: true }
    if (acceptanceCriteria.length === 0) {
      return { output: 'At least one acceptance criterion is required.', isError: true }
    }

    const taskId = generateTaskId()
    const dependencyError = validateDependencies(getState().tasks, taskId, dependencies)
    if (dependencyError) return { output: dependencyError, isError: true }
    const now = new Date()

    const task: TaskRecordState = {
      id: taskId,
      kind: 'task',
      subject: subject.trim(),
      description,
      status: 'pending',
      dependencies,
      acceptanceCriteria,
      evidence: [],
      notes: [],
      createdAt: now,
      updatedAt: now,
    }

    setState(prev => ({ ...prev, tasks: reconcileTaskGraph({ ...prev.tasks, [taskId]: task }) }))
    const stored = getState().tasks[taskId] as TaskRecordState

    return {
      output: JSON.stringify({
        taskId,
        subject: stored.subject,
        status: stored.status,
        dependencies: stored.dependencies,
        acceptanceCriteria: stored.acceptanceCriteria,
        message: `Task created. Use TaskUpdate("${taskId}", "in_progress") to start it.`,
      }),
    }
  },
})

export function getTaskRecords(): TaskRecordState[] {
  return Object.values(getState().tasks).filter(
    (t): t is TaskRecordState => t.kind === 'task',
  )
}

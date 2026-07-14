// TodoWriteTool — 会话任务清单管理
// 参考 Claude Code: TodoWriteTool
//
// 规则：
//   - 同时只能有一个 in_progress 任务
//   - allDone=true 时自动清空
//   - completed 必须携带真实工具证据，verifiedAt 由系统写入
import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { getTodos, setTodos, type Todo, type TodoStatus } from '../../services/todo-state.js'
import { hasToolEvidence } from '../../services/evidence-registry.js'

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◉',
  completed: '✓',
}
export const TodoWriteTool = buildTool({
  name: 'TodoWrite',
  description: `Manage your task checklist for the current session.

Use this tool to:
- Create a structured list of tasks before starting work
- Update task status as you progress (pending → in_progress → completed)
- Track what's done and what remains
- Define acceptance criteria and a verification command for each task
- Cite successful tool results in evidenceRefs before marking a task completed

Rules:
- Only ONE task can be in_progress at a time
- Every task requires acceptanceCriteria and verificationCommand
- A task can only become completed after it was previously in_progress
- Completed tasks require evidenceRefs that point to successful prior tool results
- Mark a task completed IMMEDIATELY after finishing it, not in batches
- Pass the complete list each time (this replaces the current list entirely)

Status values: "pending", "in_progress", "completed"

This is the lightweight session checklist. For task records with dependencies,
evidence-gated completion, or lifecycle hooks, use TaskCreate/TaskUpdate instead.`,
  isReadOnly: () => false,
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Complete replacement todo list',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique identifier (e.g., "1", "auth-1")' },
            content: { type: 'string', description: 'Task description' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current status',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Optional priority',
            },
            acceptanceCriteria: {
              type: 'array',
              description: 'Concrete checks that define when this task is done',
              items: { type: 'string' },
            },
            verificationCommand: {
              type: 'string',
              description: 'Command, file check, API check, or manual inspection used to verify completion',
            },
            evidenceRefs: {
              type: 'array',
              description: 'Tool result ids that prove completed criteria; required when status is completed',
              items: { type: 'string' },
            },
          },
          required: ['id', 'content', 'status', 'acceptanceCriteria', 'verificationCommand'],
        },
      },
    },
    required: ['todos'],
  },

  async call(input, ctx: ToolContext): Promise<ToolCallResult> {
    const namespace = ctx.agentId ?? 'main'
    const rawTodos = input['todos'] as Array<{
      id: string
      content: string
      status: string
      priority?: string
      acceptanceCriteria?: string[]
      verificationCommand?: string
      evidenceRefs?: string[]
    }>

    if (!Array.isArray(rawTodos)) {
      return { output: 'todos must be an array', isError: true }
    }

    // 元素级守卫：null / 非对象元素会让下面的 .status / .acceptanceCriteria 访问直接抛
    // TypeError,这里先以结构化错误拦下(query.ts 入口校验之外的第二道防线)。
    const badIndex = rawTodos.findIndex(t => t === null || typeof t !== 'object' || Array.isArray(t))
    if (badIndex !== -1) {
      const bad = rawTodos[badIndex]
      return {
        output: `todos[${badIndex}] must be an object, got ${bad === null ? 'null' : Array.isArray(bad) ? 'array' : typeof bad}. Each todo needs: id, content, status, acceptanceCriteria, verificationCommand.`,
        isError: true,
      }
    }

    const prev = getTodos(namespace)
    const prevById = new Map(prev.map(t => [t.id, t]))

    // ── 验证：同时只能有一个 in_progress ─────────────────────────────────
    const inProgressCount = rawTodos.filter(t => t.status === 'in_progress').length
    if (inProgressCount > 1) {
      return {
        output: `Invalid: ${inProgressCount} tasks marked in_progress. Only 1 allowed at a time.`,
        isError: true,
      }
    }

    const errors: string[] = []
    for (const raw of rawTodos) {
      if (!Array.isArray(raw.acceptanceCriteria) || raw.acceptanceCriteria.filter(Boolean).length === 0) {
        errors.push(`${raw.id}: acceptanceCriteria must include at least one concrete check`)
      }
      if (!raw.verificationCommand || raw.verificationCommand.trim().length === 0) {
        errors.push(`${raw.id}: verificationCommand is required`)
      }
      if (raw.status === 'completed') {
        const previous = prevById.get(raw.id)
        const wasAlreadyCompleted = previous?.status === 'completed'
        if (!wasAlreadyCompleted && previous?.status !== 'in_progress') {
          errors.push(`${raw.id}: completed tasks must first be in_progress`)
        }
        if (!Array.isArray(raw.evidenceRefs) || raw.evidenceRefs.filter(Boolean).length === 0) {
          errors.push(`${raw.id}: completed tasks require evidenceRefs`)
        } else {
          const unknownRefs = raw.evidenceRefs.filter(ref => !hasToolEvidence(namespace, ref))
          if (unknownRefs.length > 0) {
            errors.push(`${raw.id}: Unknown evidenceRefs: ${unknownRefs.join(', ')}`)
          }
        }
      }
    }

    if (errors.length > 0) {
      return { output: `Invalid todos:\n${errors.join('\n')}`, isError: true }
    }

    const todos: Todo[] = rawTodos.map(t => ({
      id: t.id,
      content: t.content,
      status: t.status as TodoStatus,
      priority: t.priority as Todo['priority'],
      acceptanceCriteria: (t.acceptanceCriteria ?? []).filter(Boolean),
      verificationCommand: t.verificationCommand ?? '',
      evidenceRefs: t.evidenceRefs?.filter(Boolean),
      verifiedAt: t.status === 'completed'
        ? (prevById.get(t.id)?.status === 'completed' ? prevById.get(t.id)?.verifiedAt : new Date().toISOString())
        : undefined,
    }))

    // ── 写入状态（不自动清空——UI 面板在 1.5s 延迟后负责 clearTodos）────────
    const allDone = todos.length > 0 && todos.every(t => t.status === 'completed')

    // ── Verification nudge ────────────────────────────────────────────────
    const prevCompleted = prev.filter(t => t.status === 'completed').length
    const nowCompleted = todos.filter(t => t.status === 'completed').length
    const newlyCompleted = nowCompleted - prevCompleted
    const hasVerifyStep = todos.some(
      t => /verif|test|check|confirm/i.test(t.content)
    )

    let nudge = ''
    if (allDone && todos.length >= 3 && !hasVerifyStep) {
      nudge = '\n\n⚠ All tasks marked complete without a verification step. Consider running tests or confirming output before reporting done.'
    } else if (newlyCompleted >= 3 && !hasVerifyStep) {
      nudge = '\n\n⚠ Multiple tasks completed at once without verification. Have you confirmed the output is correct?'
    }

    setTodos(todos, namespace)

    return {
      output: `Todo list updated (${todos.length} tasks).${nudge}`,
    }
  },

  renderResult(_input, output, isError) {
    if (isError) return null
    const rawTodos = (_input['todos'] as Array<{ id: string; content: string; status: string; priority?: string }>) ?? []
    if (rawTodos.length === 0) return ['Todo list cleared.']

    const lines = ['Tasks:']
    for (const t of rawTodos) {
      const icon = STATUS_ICON[t.status as TodoStatus] ?? '?'
      const priority = t.priority && t.priority !== 'medium' ? ` [${t.priority}]` : ''
      lines.push(`  ${icon} ${t.content}${priority}`)
    }
    return lines
  },
})

import type {
  AcceptanceCriterion,
  AnyTask,
  TaskEvidence,
  TaskRecordState,
  TaskRecordStatus,
} from './agent-state'

type TaskMap = Record<string, AnyTask>

export function normalizeCriteria(descriptions: string[]): AcceptanceCriterion[] {
  return descriptions
    .map(description => description.trim())
    .filter(Boolean)
    .map((description, index) => ({ id: `criterion-${index + 1}`, description }))
}

export function validateDependencies(
  tasks: TaskMap,
  taskId: string,
  dependencies: string[],
): string | null {
  if (new Set(dependencies).size !== dependencies.length) return 'Dependencies must be unique.'
  if (dependencies.includes(taskId)) return 'A task cannot depend on itself.'

  for (const dependencyId of dependencies) {
    const dependency = tasks[dependencyId]
    if (!dependency || dependency.kind !== 'task') {
      return `Task dependency "${dependencyId}" was not found.`
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const task = tasks[id]
    const next = id === taskId
      ? dependencies
      : task?.kind === 'task' ? task.dependencies : []
    for (const dependencyId of next) {
      if (visit(dependencyId)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  return visit(taskId) ? 'Task dependency cycle detected.' : null
}

export function incompleteDependencies(tasks: TaskMap, task: TaskRecordState): string[] {
  return task.dependencies.filter(id => {
    const dependency = tasks[id]
    return !dependency || dependency.kind !== 'task' || dependency.status !== 'completed'
  })
}

export function mergeEvidence(
  current: TaskEvidence[],
  incoming: TaskEvidence[],
): TaskEvidence[] {
  const byCriterion = new Map(current.map(item => [item.criterionId, item]))
  for (const item of incoming) byCriterion.set(item.criterionId, item)
  return [...byCriterion.values()]
}

export function missingEvidence(
  criteria: AcceptanceCriterion[],
  evidence: TaskEvidence[],
): string[] {
  const proven = new Set(evidence.map(item => item.criterionId))
  return criteria.filter(criterion => !proven.has(criterion.id)).map(criterion => criterion.id)
}

// ── re-plan 停止钩子（改动②）────────────────────────────────────────────────
// reconcile 只「搬状态」：把坏掉的计划点亮成 failed / invalidated，却不会主动把模型
// 拽回来修——指望模型下一轮自己想起。本函数把这些坏节点收集成一段 directive：
//   failed       → 复盘：重试 / 换方法 / 拆成更小的子任务（别静默放弃）
//   invalidated  → 重验证：上游依赖变了，已完成的证据已失效，需要重跑验证
// 返回 null 表示没有坏节点、无需打扰。文案为 high-level 指令，决策权仍在模型。
export function buildReplanDirective(records: TaskRecordState[]): string | null {
  const failed = records.filter(t => t.status === 'failed')
  const invalidated = records.filter(t => t.status === 'invalidated')
  if (failed.length === 0 && invalidated.length === 0) return null

  const map: TaskMap = {}
  for (const t of records) map[t.id] = t

  const lines: string[] = []
  lines.push('<system-reminder>')
  lines.push(
    'You are ending your turn, but your task graph still has unresolved nodes. ' +
      'Reconciliation flagged them — it does not fix them. Resolve each one before stopping; ' +
      'never silently abandon a broken task.',
  )

  if (failed.length > 0) {
    lines.push('')
    lines.push(`FAILED (${failed.length}) — diagnose, then retry, change approach, or decompose into smaller subtasks:`)
    for (const t of failed) {
      const note = t.notes.length > 0 ? ` — last note: ${t.notes[t.notes.length - 1]}` : ''
      lines.push(`  - [${t.id}] ${t.subject}${note}`)
    }
  }

  if (invalidated.length > 0) {
    lines.push('')
    lines.push(
      `INVALIDATED (${invalidated.length}) — a dependency changed after this task was completed, so its ` +
        'evidence is stale. Re-run the verification (or redo the work) and re-submit evidence via TaskUpdate:',
    )
    for (const t of invalidated) {
      const stale = incompleteDependencies(map, t)
      const because = stale.length > 0 ? ` — upstream changed: ${stale.join(', ')}` : ''
      lines.push(`  - [${t.id}] ${t.subject}${because}`)
    }
  }

  lines.push('')
  lines.push('If a node truly cannot be resolved, tell the user explicitly what is blocked and why.')
  lines.push('</system-reminder>')
  return lines.join('\n')
}

export function reconcileTaskGraph(tasks: TaskMap): TaskMap {
  let next = { ...tasks }
  let changed = true

  // INTENT: Reconcile to a fixed point so invalidation travels only through dependency edges.
  while (changed) {
    changed = false
    for (const [id, item] of Object.entries(next)) {
      if (item.kind !== 'task' || item.status === 'failed' || item.status === 'invalidated') continue
      const incomplete = incompleteDependencies(next, item)
      let status: TaskRecordStatus = item.status

      if (incomplete.length > 0) {
        status = item.status === 'completed' ? 'invalidated' : 'blocked'
      } else if (item.status === 'blocked') {
        status = 'pending'
      }

      if (status !== item.status) {
        next = {
          ...next,
          [id]: { ...item, status, updatedAt: new Date() },
        }
        changed = true
      }
    }
  }

  return next
}

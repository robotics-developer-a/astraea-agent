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

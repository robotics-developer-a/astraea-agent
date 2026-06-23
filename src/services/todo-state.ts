// TodoWrite 内存单例
// 参考 Claude Code: TodoWriteTool (AppState.todos)
//
// 按 namespace（agentId ?? 'main'）隔离，防止并发 agent 互相覆盖
// 纯内存，会话结束即消失（Astraea 无 session 恢复机制）

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface Todo {
  id: string
  content: string
  status: TodoStatus
  priority?: 'high' | 'medium' | 'low'
  acceptanceCriteria: string[]
  verificationCommand: string
  evidenceRefs?: string[]
  verifiedAt?: string
}

const _store = new Map<string, Todo[]>()

export function getTodos(namespace = 'main'): Todo[] {
  return _store.get(namespace) ?? []
}

export function setTodos(todos: Todo[], namespace = 'main'): void {
  if (todos.length === 0) {
    _store.delete(namespace)
  } else {
    _store.set(namespace, todos)
  }
}

export function clearTodos(namespace = 'main'): void {
  _store.delete(namespace)
}

export function getAllNamespaces(): string[] {
  return Array.from(_store.keys())
}

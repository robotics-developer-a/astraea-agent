// 通知队列 — 子 Agent 完成时将结果注入主 Agent 的下一轮 tool_result
// Fire-and-Observe 模式的核心：结果产生与消费解耦

const _queue: string[] = []

export function enqueueNotification(xml: string): void {
  _queue.push(xml)
}

export function drainNotifications(): string[] {
  return _queue.splice(0, _queue.length)
}

export function hasPendingNotifications(): boolean {
  return _queue.length > 0
}

export function enqueueAgentNotification(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  result?: string,
  error?: string,
  durationMs?: number,
): void {
  const lines = [
    '<task_notification>',
    `  <task_id>${taskId}</task_id>`,
    `  <status>${status}</status>`,
  ]
  if (result) lines.push(`  <result>${result.slice(0, 8192)}</result>`)
  if (error) lines.push(`  <error>${error.slice(0, 1024)}</error>`)
  if (durationMs != null) lines.push(`  <duration_ms>${durationMs}</duration_ms>`)
  lines.push('</task_notification>')
  enqueueNotification(lines.join('\n'))
}

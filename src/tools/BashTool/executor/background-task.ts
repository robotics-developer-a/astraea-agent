// 后台任务管理器 — 文档 §5"后台任务自动切换"
// 支持：提交后台任务、查询状态、等待结束

import { randomUUID } from 'crypto'

export interface BackgroundTask {
  id: string
  command: string
  startedAt: Date
  /** null 表示仍在运行 */
  exitCode: number | null
  stdout: string
  stderr: string
}

// 模块级任务注册表
const tasks = new Map<string, BackgroundTask & { proc: ReturnType<typeof Bun.spawn> }>()

/**
 * 以后台方式启动命令，立即返回 taskId。
 * 调用方后续可用 taskId 查询或等待结果。
 */
export function spawnBackground(
  command: string,
  shell: string,
  cwd: string,
  env: Record<string, string>,
): string {
  const id = randomUUID()

  const proc = Bun.spawn([shell, '-c', command], {
    cwd,
    env: { ...env, ASTRAEA: '1', ASTRAEA_TASK_ID: id },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const task: BackgroundTask & { proc: typeof proc } = {
    id,
    command,
    startedAt: new Date(),
    exitCode: null,
    stdout: '',
    stderr: '',
    proc,
  }

  tasks.set(id, task)

  // 异步收集输出
  void collectOutput(task)

  return id
}

async function collectOutput(
  task: BackgroundTask & { proc: ReturnType<typeof Bun.spawn> },
): Promise<void> {
  const [stdout, stderr] = await Promise.all([
    new Response(task.proc.stdout as ReadableStream).text(),
    new Response(task.proc.stderr as ReadableStream).text(),
  ])
  await task.proc.exited
  task.stdout = stdout.slice(0, 64 * 1024 * 1024)
  task.stderr = stderr.slice(0, 1024 * 1024)
  task.exitCode = task.proc.exitCode ?? 0
}

export function getTask(id: string): BackgroundTask | undefined {
  const t = tasks.get(id)
  if (!t) return undefined
  return { id: t.id, command: t.command, startedAt: t.startedAt, exitCode: t.exitCode, stdout: t.stdout, stderr: t.stderr }
}

/** 等待后台任务完成，最多等 timeoutMs 毫秒。返回最终快照。 */
export async function waitForTask(id: string, timeoutMs = 30_000): Promise<BackgroundTask | undefined> {
  const entry = tasks.get(id)
  if (!entry) return undefined

  const deadline = Date.now() + timeoutMs
  while (entry.exitCode === null && Date.now() < deadline) {
    await Bun.sleep(200)
  }

  return getTask(id)
}

export function listTasks(): BackgroundTask[] {
  return [...tasks.values()].map((t) => ({
    id: t.id, command: t.command, startedAt: t.startedAt,
    exitCode: t.exitCode, stdout: t.stdout, stderr: t.stderr,
  }))
}

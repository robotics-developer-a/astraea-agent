// 后台任务管理器 — 文档 §5"后台任务自动切换"
// 支持：提交后台任务、查询状态、等待结束

import { randomUUID } from 'crypto'
import { runDetached } from '../../../utils/detachedTask'
import { readStreamBounded } from './readStreamBounded'

const MAX_STDOUT_BYTES = 64 * 1024 * 1024 // 与前台 executor 一致
const MAX_STDERR_BYTES = 1024 * 1024

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
  runDetached(collectOutput(task), err => {
    task.stderr = `Background output collection failed: ${err instanceof Error ? err.message : String(err)}`
    task.exitCode = -1
  })

  return id
}

async function collectOutput(
  task: BackgroundTask & { proc: ReturnType<typeof Bun.spawn> },
): Promise<void> {
  // readStreamBounded 而非 Response(stream).text()：
  //   ① 边读边截断——`.text()` 把全部输出攒进内存后才截断，长跑后台命令（yes、
  //      冗长构建日志）会把 REPL 进程 OOM 打崩；
  //   ② 以 proc.exited 为读取边界——脱离的常驻孙进程占住管道时不会永久挂死。
  const exited = task.proc.exited
  const [stdout, stderr] = await Promise.all([
    readStreamBounded(task.proc.stdout as ReadableStream<Uint8Array>, exited, MAX_STDOUT_BYTES),
    readStreamBounded(task.proc.stderr as ReadableStream<Uint8Array>, exited, MAX_STDERR_BYTES),
  ])
  await exited
  task.stdout = stdout.slice(0, MAX_STDOUT_BYTES)
  task.stderr = stderr.slice(0, MAX_STDERR_BYTES)
  // 被信号杀死时 exitCode 为 null——按失败上报，别伪装成 exit 0 的成功
  task.exitCode = task.proc.exitCode ?? -1
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

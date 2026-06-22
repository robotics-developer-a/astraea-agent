// vigil 任务持久化 — 读写 ~/.astraea/scheduled_tasks.json
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { writePrivateFile } from './privateFile'

export interface VigilTask {
  id: string
  cron?: string            // 周期任务的 cron 表达式，一次性任务不填
  prompt: string           // 触发时注入的 prompt
  description: string      // 人类可读描述
  recurring: boolean
  durable: boolean         // true = 写磁盘跨 session，false = 仅本 session
  nextFireAt: number       // Unix ms
  createdAt: number
  lastFiredAt?: number
  cwd?: string             // 调度时的工作目录，headless agent 用这个目录启动
}

function getAstraeaDir(): string {
  const dir = join(homedir(), '.astraea')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getTasksFilePath(): string {
  return join(getAstraeaDir(), 'scheduled_tasks.json')
}

export function getDaemonPidPath(): string {
  return join(getAstraeaDir(), 'daemon.pid')
}

export function readTasks(): VigilTask[] {
  const path = getTasksFilePath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as VigilTask[]
  } catch {
    return []
  }
}

export function writeTasks(tasks: VigilTask[]): void {
  writePrivateFile(getTasksFilePath(), JSON.stringify(tasks, null, 2))
}

export function addTask(task: VigilTask): void {
  const tasks = readTasks()
  tasks.push(task)
  writeTasks(tasks)
}

// ── Daemon 管理 ────────────────────────────────────────────────────────────

export function isDaemonRunning(): boolean {
  const pidPath = getDaemonPidPath()
  const { existsSync, readFileSync } = require('node:fs')
  if (!existsSync(pidPath)) return false
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function startDaemon(): void {
  const { join } = require('node:path')
  const cliPath = join(import.meta.dir, '../cli.ts')
  Bun.spawn([process.execPath, cliPath, '--daemon'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
}

export function ensureDaemon(): boolean {
  const wasRunning = isDaemonRunning()
  if (!wasRunning) startDaemon()
  return wasRunning
}

export function removeTask(id: string): boolean {
  const tasks = readTasks()
  const next = tasks.filter(t => t.id !== id)
  if (next.length === tasks.length) return false
  writeTasks(next)
  return true
}

export function updateTask(id: string, patch: Partial<VigilTask>): void {
  const tasks = readTasks()
  const idx = tasks.findIndex(t => t.id === id)
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx]!, ...patch }
    writeTasks(tasks)
  }
}

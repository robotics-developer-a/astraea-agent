// Astraea cron daemon — 极轻量调度进程
// 职责：读取 ~/.astraea/scheduled_tasks.json，每秒 check，到点触发 headless agent
// 本体不调用 LLM；LLM 调用发生在 Bun.spawn 出的 headless 子进程中
//
// 启动方式（由 CronCreateTool 或 cli.ts --daemon 触发）：
//   bun run src/cli.ts --daemon

import { readTasks, writeTasks, getDaemonPidPath } from '../utils/vigilTasks.js'
import { calcNextFireAt } from './cron-scheduler.js'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const TICK_MS = 1_000
const RESULT_DIR_VAR = 'ASTRAEA_TASK_RESULT_DIR'

function getResultDir(): string {
  const { homedir } = require('node:os')
  const dir = join(homedir(), '.astraea', 'task-results')
  require('node:fs').mkdirSync(dir, { recursive: true })
  return dir
}

async function fireTask(taskId: string, prompt: string, cwd?: string): Promise<void> {
  const resultDir = getResultDir()
  const resultFile = join(resultDir, `${taskId}.json`)
  const spawnCwd = cwd ?? process.cwd()

  console.log(`[vigil] Firing task ${taskId} (cwd=${spawnCwd}): ${prompt.slice(0, 60)}`)

  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, '../cli.ts'), '--headless', '--task', taskId],
    {
      cwd: spawnCwd,
      env: {
        ...process.env,
        ASTRAEA_HEADLESS_PROMPT: prompt,
        ASTRAEA_HEADLESS_TASK_ID: taskId,
        [RESULT_DIR_VAR]: resultDir,
        ASTRAEA_RESULT_FILE: resultFile,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const exitCode = await proc.exited
  console.log(`[vigil] Task ${taskId} exited with code ${exitCode}`)

  // On non-zero exit, write a failure result so the REPL can surface it
  if (exitCode !== 0) {
    const failure = {
      taskId,
      prompt,
      output: `Task exited with code ${exitCode}. Check daemon logs for details.`,
      completedAt: new Date().toISOString(),
      read: false,
      failed: true,
    }
    writeFileSync(resultFile, JSON.stringify(failure, null, 2), 'utf-8')
  }
}

export async function runDaemon(): Promise<void> {
  // 写 PID 文件
  writeFileSync(getDaemonPidPath(), String(process.pid), 'utf-8')
  console.log(`[vigil daemon] started (pid ${process.pid})`)

  process.on('exit', () => {
    try { unlinkSync(getDaemonPidPath()) } catch { /* ignore */ }
  })
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT',  () => process.exit(0))

  while (true) {
    const tasks = readTasks()

    if (tasks.length === 0) {
      console.log('[vigil daemon] no tasks remaining, exiting.')
      process.exit(0)
    }

    const now = Date.now()
    const updated = [...tasks]

    for (let i = 0; i < updated.length; i++) {
      const task = updated[i]!
      if (task.nextFireAt <= now) {
        // Fire — don't await (non-blocking)
        fireTask(task.id, task.prompt, task.cwd).catch(err =>
          console.error(`[vigil] task ${task.id} error:`, err),
        )

        if (task.recurring && task.cron) {
          updated[i] = {
            ...task,
            lastFiredAt: now,
            nextFireAt: calcNextFireAt(task.cron, now),
          }
        } else {
          // One-shot: remove after firing
          updated.splice(i, 1)
          i--
        }
      }
    }

    writeTasks(updated)
    await Bun.sleep(TICK_MS)
  }
}

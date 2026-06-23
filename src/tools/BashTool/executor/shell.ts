// Shell 执行核心 — 文档 §6 MVP executor/shell.ts
// 特性：超时控制、输出 64MB 截断、CWD 追踪、bash/zsh 自动选择

import { getCurrentCwd, wrapWithCwdTracking, syncCwd } from './cwd-tracker.js'
import { readStreamBounded } from './readStreamBounded.js'

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024 // 64 MB
const MAX_STDERR_BYTES = 1024 * 1024       // 1 MB
const DEFAULT_TIMEOUT_MS = 120_000         // 2 分钟
const MAX_TIMEOUT_MS = 600_000             // 10 分钟

export interface BashInput {
  command: string
  timeout?: number
  description?: string
  run_in_background?: boolean
}

export interface BashOutput {
  stdout: string
  stderr: string
  exitCode: number
  interrupted: boolean
  timedOut: boolean
}

/** 选择 bash 或 zsh（与用户 shell 一致），回退到 /bin/bash */
function findSuitableShell(): string {
  const userShell = process.env.SHELL ?? ''
  if (/\/(bash|zsh)$/.test(userShell)) return userShell
  return '/bin/bash'
}

/**
 * Streaming variant: yields stdout chunks as they arrive, then returns
 * the full BashOutput. stderr is collected separately and included in the return value.
 */
export async function* executeStreamingBash(
  input: BashInput,
  signal?: AbortSignal,
): AsyncGenerator<string, BashOutput> {
  const shell = findSuitableShell()
  const timeoutMs = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const cwd = getCurrentCwd()

  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal

  const wrappedCommand = wrapWithCwdTracking(input.command)
  let timedOut = false
  let interrupted = false

  try {
    const proc = Bun.spawn([shell, '-c', wrappedCommand], {
      cwd,
      env: { ...process.env as Record<string, string>, ASTRAEA: '1', TERM: 'xterm-256color' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const abortHandler = () => proc.kill()
    combinedSignal.addEventListener('abort', abortHandler, { once: true })

    // Stream stdout chunk by chunk. 以 proc.exited 为边界：进程退出 + grace 后放弃
    // 管道句柄，避免被脱离的常驻孙进程占住 stdout 而永久卡死。
    const exited = proc.exited
    const decoder = new TextDecoder()
    let capturedStdout = ''
    const reader = proc.stdout.getReader()
    let abandoned = false
    void exited.then(() => {
      const t = setTimeout(() => {
        abandoned = true
        void reader.cancel().catch(() => {})
      }, 200)
      ;(t as { unref?: () => void }).unref?.()
    })

    try {
      while (!abandoned) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        capturedStdout += chunk
        if (capturedStdout.length <= MAX_OUTPUT_BYTES) yield chunk
      }
    } catch {
      // reader 被 cancel —— 正常的放弃路径
    }

    const stderr = await readStreamBounded(proc.stderr, exited, MAX_STDERR_BYTES)
    await exited
    combinedSignal.removeEventListener('abort', abortHandler)
    clearTimeout(timer)
    await syncCwd()

    return {
      stdout: capturedStdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: stderr.slice(0, MAX_STDERR_BYTES),
      exitCode: proc.exitCode ?? 0,
      interrupted,
      timedOut,
    }
  } catch (err) {
    clearTimeout(timer)
    if (timeoutController.signal.aborted && !signal?.aborted) timedOut = true
    else if (signal?.aborted) interrupted = true
    return { stdout: '', stderr: timedOut ? `Timed out after ${timeoutMs}ms` : String(err), exitCode: -1, interrupted, timedOut }
  }
}

export async function executeBash(
  input: BashInput,
  signal?: AbortSignal,
): Promise<BashOutput> {
  const shell = findSuitableShell()
  const timeoutMs = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const cwd = getCurrentCwd()

  // 超时控制
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  const combinedSignal =
    signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal

  // 包装命令以追踪 CWD 变化
  const wrappedCommand = wrapWithCwdTracking(input.command)

  let timedOut = false
  let interrupted = false

  try {
    const proc = Bun.spawn([shell, '-c', wrappedCommand], {
      cwd,
      env: {
        ...process.env as Record<string, string>,
        ASTRAEA: '1',
        TERM: 'xterm-256color',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // 监听取消信号
    const abortHandler = () => proc.kill()
    combinedSignal.addEventListener('abort', abortHandler, { once: true })

    // 以 proc.exited 为边界读取，避免被脱离的常驻孙进程占住管道而永久卡死。
    const exited = proc.exited
    const [stdout, stderr] = await Promise.all([
      readStreamBounded(proc.stdout, exited, MAX_OUTPUT_BYTES),
      readStreamBounded(proc.stderr, exited, MAX_STDERR_BYTES),
    ])

    await exited
    combinedSignal.removeEventListener('abort', abortHandler)
    clearTimeout(timer)

    // 命令完成后同步新 CWD
    await syncCwd()

    return {
      stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: stderr.slice(0, MAX_STDERR_BYTES),
      exitCode: proc.exitCode ?? 0,
      interrupted,
      timedOut,
    }
  } catch (err) {
    clearTimeout(timer)
    if (timeoutController.signal.aborted && !signal?.aborted) {
      timedOut = true
    } else if (signal?.aborted) {
      interrupted = true
    }
    return {
      stdout: '',
      stderr: timedOut ? `Command timed out after ${timeoutMs}ms` : String(err),
      exitCode: -1,
      interrupted,
      timedOut,
    }
  }
}

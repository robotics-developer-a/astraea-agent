import { getCurrentCwd } from '../../BashTool/executor/cwd-tracker.js'
import { readStreamBounded } from '../../BashTool/executor/readStreamBounded.js'

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_STDERR_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000

export interface PsInput {
  command: string
  timeout?: number
  description?: string
}

export interface PsOutput {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  interrupted: boolean
}

let cachedPwsh: string | null | undefined

async function findPwsh(): Promise<string | null> {
  if (cachedPwsh !== undefined) return cachedPwsh
  // prefer pwsh (PowerShell 7+, cross-platform), fall back to powershell (Windows built-in).
  // Probe the binary directly rather than via `which`/`where` — `which` doesn't exist on
  // Windows and `where` doesn't exist on Unix, so resolver names aren't portable.
  for (const bin of ['pwsh', 'powershell']) {
    try {
      const proc = Bun.spawn([bin, '-NoProfile', '-Command', '$null'], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
      // 探测也要有界:损坏的 pwsh 安装可能挂起,5s 内不退出就放弃该候选
      const probeTimer = setTimeout(() => { try { proc.kill() } catch { /* dead */ } }, 5_000)
      await proc.exited
      clearTimeout(probeTimer)
      if (proc.exitCode === 0) {
        cachedPwsh = bin
        return bin
      }
    } catch {
      // ENOENT: binary not on PATH — try the next candidate
    }
  }
  cachedPwsh = null
  return null
}

export async function executePowerShell(input: PsInput, signal?: AbortSignal): Promise<PsOutput> {
  const pwsh = await findPwsh()
  if (!pwsh) {
    return {
      stdout: '',
      stderr: 'PowerShell (pwsh) is not installed. Install it from https://github.com/PowerShell/PowerShell',
      exitCode: 127,
      timedOut: false,
      interrupted: false,
    }
  }

  const timeoutMs = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const cwd = getCurrentCwd()

  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  // 与 Bash executor 同款:调用方信号(ESC)与超时信号合并,任一触发都 kill 子进程
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal

  let timedOut = false
  let interrupted = false

  try {
    const proc = Bun.spawn(
      [pwsh, '-NonInteractive', '-NoProfile', '-Command', input.command],
      {
        cwd,
        env: { ...(process.env as Record<string, string>), ASTRAEA: '1' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const abortHandler = () => proc.kill()
    combinedSignal.addEventListener('abort', abortHandler, { once: true })

    // 以 proc.exited 为边界读取：PowerShell 的 Start-Process 会启动脱离的常驻进程并继承
    // 管道句柄，若死等 EOF 整个工具调用会永久卡死。进程退出后只再排干残留输出即返回。
    const exited = proc.exited
    const [stdout, stderr] = await Promise.all([
      readStreamBounded(proc.stdout, exited, MAX_OUTPUT_BYTES),
      readStreamBounded(proc.stderr, exited, MAX_STDERR_BYTES),
    ])

    await exited
    combinedSignal.removeEventListener('abort', abortHandler)
    clearTimeout(timer)
    // 超时/中断走 proc.kill()，exited 正常 resolve、不进 catch——标志必须在这里从信号推导。
    // 被杀死时 proc.exitCode 为 null，绝不能 ?? 0 伪装成功（对齐 Bash executor 同款修复）。
    if (timeoutController.signal.aborted && !signal?.aborted) timedOut = true
    else if (signal?.aborted) interrupted = true

    return {
      stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: (timedOut ? `${stderr}\nCommand timed out after ${timeoutMs}ms` : stderr).slice(0, MAX_STDERR_BYTES),
      exitCode: proc.exitCode ?? (timedOut || interrupted ? -1 : 0),
      timedOut,
      interrupted,
    }
  } catch (err) {
    clearTimeout(timer)
    if (timeoutController.signal.aborted && !signal?.aborted) timedOut = true
    else if (signal?.aborted) interrupted = true
    return {
      stdout: '',
      stderr: timedOut ? `Command timed out after ${timeoutMs}ms` : String(err),
      exitCode: -1,
      timedOut,
      interrupted,
    }
  }
}

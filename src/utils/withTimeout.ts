// 超时/信号组合工具 —— 可靠性审计 PR-3
//
// 全仓多个 I/O 点(UDS 发送、MCP 调用、子进程等待)此前没有超时,对端不响应即永久挂起。
// 这里提供两个最小原语,各调用点统一用它们,不再各写各的 setTimeout/clearTimeout。

/**
 * 给任意 Promise 套墙钟超时。超时 reject Error(`${label} timed out after ${ms}ms`)。
 * 注意:超时不会取消底层操作 —— 需要真正取消时,调用方应额外用 combineSignals
 * 把 AbortSignal 传进底层(fetch/spawn),或在 onTimeout 里主动清理资源。
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try { onTimeout?.() } catch { /* cleanup is best-effort */ }
          reject(new Error(`${label} timed out after ${ms}ms`))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 组合「调用方的取消信号」与「墙钟超时」为一个 AbortSignal。
 * signal 为空时退化为纯超时信号。AbortSignal.timeout 自管定时器,无泄漏。
 */
export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

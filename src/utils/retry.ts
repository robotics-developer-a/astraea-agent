// 网络请求重试原语 —— 可靠性审计 PR-4
//
// 适用对象:WebFetch / WebSearch adapter / MCP callTool 这类幂等(或只读)网络调用。
// 策略:指数退避;4xx 不重试(请求本身错,重试无意义),5xx / 超时 / 网络层错误重试;
// 用户取消(opts.signal)立即停止,绝不把 ESC 变成「再试两次」。

export interface RetryOptions {
  /** 额外重试次数(不含首次尝试)。默认 2。 */
  retries?: number
  /** 首次退避毫秒数,之后指数翻倍(500 → 1000 → 2000)。默认 500。 */
  baseDelayMs?: number
  /** 调用方取消信号:已触发时不再发起新尝试,直接抛出。 */
  signal?: AbortSignal
  /** 判定某个错误是否值得重试。默认 isTransientNetworkError。 */
  shouldRetry?: (err: unknown) => boolean
  /** 用于错误消息前缀的标签。 */
  label?: string
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 500
  const shouldRetry = opts.shouldRetry ?? isTransientNetworkError

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw lastErr ?? new Error(`${opts.label ?? 'operation'} aborted`)
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      // 用户已取消 → 无论错误类型都不再重试
      if (opts.signal?.aborted) throw err
      if (attempt >= retries || !shouldRetry(err)) throw err
      await Bun.sleep(baseDelayMs * 2 ** attempt)
    }
  }
  throw lastErr
}

/**
 * 瞬态网络错误判定:
 *   - 消息含 HTTP 4xx 状态码 → 不重试(鉴权/参数/配额问题,重试只会更糟)
 *   - 消息含 HTTP 5xx → 重试
 *   - 超时 / abort(per-attempt 超时信号)/ DNS / 连接层错误 → 重试
 *   - 其他(业务逻辑错误、解析失败)→ 不重试
 */
export function isTransientNetworkError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase()
  if (/\b4\d\d\b/.test(msg)) return false
  if (/\b5\d\d\b/.test(msg)) return true
  return /timed? ?out|timeout|abort|econnreset|econnrefused|epipe|enotfound|eai_again|network|fetch failed|socket|connection/.test(msg)
}

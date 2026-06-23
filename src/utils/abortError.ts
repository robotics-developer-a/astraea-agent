// 统一的"请求被中止"判定 —— ESC / 看门狗 abort 的错误识别。
//
// 为什么需要：中止一个 SDK 流式请求时，错误形态因来源而异：
//   1. 原生 fetch / DOMException → name === 'AbortError'
//   2. Anthropic / OpenAI SDK   → APIUserAbortError，其 name 是默认的 'Error'
//      （基类没设 this.name），message 固定为 'Request was aborted.'
// 历史代码只判 `err.name === 'AbortError'`，于是 SDK 抛的 APIUserAbortError 漏网，
// 被当成真错误冒泡 → UI 显示「■ Error. Request was aborted.」、/goal 状态也未清理。
//
// 本函数把这两种形态统一识别为「中止」。可选传入 signal：只要该信号已 aborted，
// 就把任何随之而来的错误一律视为中止（最可靠的旁证，覆盖 provider 文案差异）。

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError') return true
  // SDK 的 APIUserAbortError：name 退化为 'Error'，靠固定 message 识别。
  if (err.message === 'Request was aborted.') return true
  return false
}

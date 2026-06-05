// 主对话的上下文 token 状态 + 压缩熔断 —— 进程级单例（设计文档 §6/§8）。
//
// 为什么是单例：主对话 conversationRef 在 App 里跨「每个用户 turn 一次 query() 调用」存活，
// 所以"当前上下文 token 数"必须跨 query() 调用持久。query() 在每次 message_stop 更新它，
// 发请求前的阈值检查读它，App 在 /clear、/login 时 reset。
//
// 只追踪主对话（query() 里 agentId === 'default'）；子 agent 走独立 runSubAgent 循环，
// 不碰这个单例，天然无污染。

// 触发用聚合 API input_tokens（provider 自己分词器算的真值）。null = 未知
// （首轮响应前，或 /login 换模型后旧分词器的数作废、等新 usage 刷新）。
let lastInputTokens: number | null = null

// 双触发熔断：连续 N 次「硬失败」或「压不动」→ 跳闸。
const MAX_CONSECUTIVE = 3
let consecutiveHardFailures = 0    // 压缩操作报错
let consecutiveWillRetrigger = 0   // 压缩成功但压缩后仍 ≥ 阈值
let tripped = false

/** query() 每次 message_stop 调用：记录最近一次响应的 input_tokens。 */
export function recordInputTokens(n: number): void {
  if (Number.isFinite(n) && n >= 0) lastInputTokens = n
}

/** 当前上下文 token 数；null = 未知（此时不触发自动压缩）。 */
export function getInputTokens(): number | null {
  return lastInputTokens
}

/** /login 换模型后：旧分词器的数对新模型不准 → 视为未知，下轮响应刷新。 */
export function markTokensUnknown(): void {
  lastInputTokens = null
}

/** /clear：完全重置（新对话从零开始，熔断也清）。 */
export function resetContextTokens(): void {
  lastInputTokens = null
  consecutiveHardFailures = 0
  consecutiveWillRetrigger = 0
  tripped = false
}

/** 压缩操作报错（模型调用挂）。连续 MAX_CONSECUTIVE 次 → 跳闸。 */
export function recordCompactionFailure(): void {
  consecutiveHardFailures += 1
  if (consecutiveHardFailures >= MAX_CONSECUTIVE) tripped = true
}

/**
 * 一次压缩成功后调用，传入压缩后是否仍会立刻重压（willRetriggerNextTurn）。
 * - 干净压缩（未 retrigger）→ 清零两个连击计数；
 * - 压不动（retrigger）→ willRetrigger 连击 +1，达 MAX_CONSECUTIVE 跳闸。
 * 无论哪种，成功都清零 hardFailures。
 */
export function recordCompactionResult(willRetrigger: boolean): void {
  consecutiveHardFailures = 0
  if (willRetrigger) {
    consecutiveWillRetrigger += 1
    if (consecutiveWillRetrigger >= MAX_CONSECUTIVE) tripped = true
  } else {
    consecutiveWillRetrigger = 0
  }
}

/** 熔断是否已跳闸：跳闸后停止自动压缩，提示用户手动裁剪/开新会话。 */
export function isCompactionTripped(): boolean {
  return tripped
}

// §5-#8: 限制并发子 agent 数 —— 避免 provider 限流(429) 与成本尖峰。
// 超出上限的 acquire 排队，release 时 FIFO 移交槽位。模块级单例（全进程共享一个闸）。
let active = 0
const waiters: Array<() => void> = []

export function maxConcurrentAgents(): number {
  const raw = Number(process.env.ASTRAEA_MAX_CONCURRENT_AGENTS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5
}

export async function acquireAgentSlot(): Promise<void> {
  if (active < maxConcurrentAgents()) {
    active++
    return
  }
  // 满额：排队等待。被 release 唤醒时槽位已移交（active 不变），无需自增。
  await new Promise<void>(resolve => waiters.push(resolve))
}

export function releaseAgentSlot(): void {
  const next = waiters.shift()
  if (next) next()           // 槽位移交给下一个等待者，active 不变
  else if (active > 0) active--
}

// 仅供测试：重置单例状态。
export function resetAgentConcurrency(): void {
  active = 0
  waiters.length = 0
}

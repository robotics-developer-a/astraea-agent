// 扫光共享时钟 —— 所有 running 工具行共用「一个」120ms 节拍器。
//
// 为什么共享而非各行各自 setInterval：并行跑 N 个工具时，N 个独立定时器相位错开会让
// live frame 在不同时刻被多次触发重绘，抖动且费 CPU。共享一个 tick → 所有行同一相位
// （Q11「一根竖亮柱」要求按列对齐，本就必须同相）→ 每 120ms 只触发一轮重绘。
//
// 生命周期：有订阅者（至少一条 running 行）才开钟；最后一条落盘退订后自动停钟，空闲零开销。

const TICK_MS = 120

let phase = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function ensureRunning(): void {
  if (timer) return
  timer = setInterval(() => {
    phase = (phase + 1) % 1_000_000  // 防溢出；远大于任何 bandWidth
    for (const l of listeners) l()
  }, TICK_MS)
  // 不阻塞进程退出（Bun/Node）：定时器仅服务于 UI 动画。
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    ;(timer as { unref: () => void }).unref()
  }
}

function maybeStop(): void {
  if (listeners.size === 0 && timer) {
    clearInterval(timer)
    timer = null
  }
}

// 订阅节拍：返回退订函数。挂载即开钟、卸载即（可能）停钟。
export function subscribeSweep(cb: () => void): () => void {
  listeners.add(cb)
  ensureRunning()
  return () => {
    listeners.delete(cb)
    maybeStop()
  }
}

// 当前全局相位（单调递增的整数；亮柱位置 = phase % bandWidth）。
export function sweepPhase(): number {
  return phase
}

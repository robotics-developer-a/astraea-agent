// 上下文窗口与阈值计算 —— 纯函数，无副作用（设计文档 §2/§3/§4）。
//
// 全部按 effectiveWindow 的百分比表达，不用绝对 token buffer：Astraea 窗口跨 8K–1M，
// 任何写死的绝对预留量在小窗口上都会失效。阈值每次现算（从当前激活 provider 的
// contextWindow/maxOutput 取值），所以 /login 换模型后自动生效。

import { activeContextWindow, activeMaxTokens } from '../../config'

// 给输出留位置，保证 输入 + 输出 ≤ contextWindow。
// 预留量以真实 maxOutput 为下界（+ pad 兜 thinking/估算误差），但 cap 在窗口一半，
// 防止"大输出上限 × 小窗口"把 effective window 压到 0。
const SAFETY_PAD = 2_000

export function effectiveWindow(contextWindow: number, maxOutput: number): number {
  const reserved = Math.min(maxOutput + SAFETY_PAD, Math.floor(contextWindow * 0.5))
  return contextWindow - reserved
}

// 三档阶梯比例（× effectiveWindow）。
export const WARNING_RATIO = 0.80      // UI 警告
export const AUTOCOMPACT_RATIO = 0.92  // 自动压缩触发
export const BLOCKING_RATIO = 0.98     // 硬阻塞（仅 autocompact 关闭时）

// 压缩后落点目标：压缩后总占用（固定开销 + 摘要 + 最近）落在 ⅓ 窗口左右（设计文档 §7）。
export const LANDING_RATIO = 0.35

export interface Thresholds {
  effectiveWindow: number
  warning: number
  autocompact: number
  blocking: number
}

export function thresholds(eff: number): Thresholds {
  return {
    effectiveWindow: eff,
    warning: Math.floor(eff * WARNING_RATIO),
    autocompact: Math.floor(eff * AUTOCOMPACT_RATIO),
    blocking: Math.floor(eff * BLOCKING_RATIO),
  }
}

// 从当前激活 provider 现算（每次调用都读最新 config，/login 后自动用新模型的数）。
export function activeThresholds(): Thresholds {
  const eff = effectiveWindow(activeContextWindow(), activeMaxTokens())
  return thresholds(eff)
}

// 压缩后落点目标的绝对 token 数。
export function landingTarget(eff: number): number {
  return Math.floor(eff * LANDING_RATIO)
}

// UI 剩余百分比，相对 autocompact 阈值（设计文档 §4）。
export function percentLeft(used: number, autocompactThreshold: number): number {
  if (autocompactThreshold <= 0) return 0
  return Math.max(0, Math.round(((autocompactThreshold - used) / autocompactThreshold) * 100))
}

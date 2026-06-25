// SessionState 聚合 — 所有「新会话时需清除」的状态单点归口
//
// 设计意图：
//   state/ 下每个文件持有各自的模块级单例（contextTokens / microcompactState /
//   goalState / ...）。新增一个状态就要在每个 reset 点补一行 import + 调用，
//   没有类型系统保障不会漏掉。
//
//   本文件提供聚合函数，把「/clear 时需 reset」和「/login 时需标记失效」
//   的状态操作归口到两处，新增状态只需在本文件追加一行 reset/mark-stale。
//
//   每个状态的独立 API 保持不变（向后兼容），聚合函数是补充，不是替代。

import { resetContextTokens, markTokensUnknown } from './contextTokens'
import { resetMicrocompactState } from './microcompactState'
import { clearGoal } from './goalState'

/**
 * /clear：重置所有会话级状态，开始全新对话。
 *
 * 清理项：
 *   - contextTokens    — 上次响应 input token 数 + 压缩熔断
 *   - microcompactState — 最后一条 assistant 时间戳
 *   - goalState        — 任何激活中的 /goal 目标
 *
 * 不在清理范围（跨会话存活）：
 *   - sessionMode      — 模式是显式用户意图（如 forge/orbit/cruise/counsel），
 *                        不应被 /clear 抹掉
 *   - reasoningEffort  — 推理强度是会话偏好设定，不是临时状态
 *   - usageStats       — 已消耗的 token 和费用（钱已经花了）
 */
export function resetSessionStates(): void {
  resetContextTokens()
  resetMicrocompactState()
  clearGoal()
}

/**
 * /login / --resume：换模型后标记相关状态失效，等待新的 API usage 刷新。
 *
 * 标记项：
 *   - contextTokens 的 markTokensUnknown — 旧分词器的 token 数对新模型不准
 *
 * 不处理（硬清理不合适）：
 *   - Eclipse store  — 通过 resetEclipse() 在调用方（App.tsx）处清理
 */
export function markSessionStale(): void {
  markTokensUnknown()
}

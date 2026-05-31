// Token 预算追踪系统
// 参考 claude-code-main/src/query/tokenBudget.ts:45-93
//
// 两层关注点严格分离：
//   STATIC  → TOKEN_BUDGET_HINT_TEXT：注入系统提示一次，永久缓存
//   RUNTIME → BudgetTracker：每个 agent 独立创建，不可变更新，防止跨 agent 污染

// ─── 静态系统提示文本 ──────────────────────────────────────────────────────────

export const TOKEN_BUDGET_HINT_TEXT =
  'When the user specifies a token target (e.g., "+500k", "spend 2M tokens", ' +
  '"use 1B tokens"), your output token count will be shown each turn. Keep ' +
  'working until you approach the target — plan your work to fill it ' +
  'productively. The target is a hard minimum, not a suggestion. If you stop ' +
  'early, the system will automatically continue you.'

// ─── 运行时预算追踪器 ──────────────────────────────────────────────────────────

export type BudgetTracker = {
  readonly agentId: string
  continuationCount: number
  lastDeltaTokens: number
  lastGlobalTurnTokens: number
  readonly startedAt: number
  recentDeltas: number[]         // 最近 N 轮的 delta，用于递减收益检测
}

export function createBudgetTracker(agentId: string): BudgetTracker {
  return {
    agentId,
    continuationCount: 0,
    lastDeltaTokens: 0,
    lastGlobalTurnTokens: 0,
    startedAt: Date.now(),
    recentDeltas: [],
  }
}

// 不可变更新：返回新对象，不修改原 tracker，防止父子 agent 间的别名污染
export function recordTurnTokens(
  tracker: BudgetTracker,
  deltaTokens: number,
): BudgetTracker {
  const WINDOW_SIZE = 3

  const recentDeltas = [
    ...tracker.recentDeltas.slice(-(WINDOW_SIZE - 1)),
    deltaTokens,
  ]

  return {
    ...tracker,
    continuationCount: tracker.continuationCount + 1,
    lastDeltaTokens: deltaTokens,
    lastGlobalTurnTokens: tracker.lastGlobalTurnTokens + deltaTokens,
    recentDeltas,
  }
}

// ─── 预算决策 ──────────────────────────────────────────────────────────────────

const COMPLETION_THRESHOLD = 0.9
const DIMINISHING_DELTA_THRESHOLD = 500
const DIMINISHING_WINDOW = 3

export type BudgetDecision =
  | { action: 'continue' }
  | { action: 'stop'; reason: 'budget_reached' | 'diminishing_returns' }

export function checkTokenBudget(
  tracker: BudgetTracker,
  budget: number | null,
): BudgetDecision {
  if (budget === null) return { action: 'continue' }

  if (tracker.lastGlobalTurnTokens / budget >= COMPLETION_THRESHOLD) {
    return { action: 'stop', reason: 'budget_reached' }
  }

  // 滑动窗口检测：只有连续 N 轮都低于阈值才停止，防止累计计数器误杀长会话
  if (
    tracker.recentDeltas.length >= DIMINISHING_WINDOW &&
    tracker.recentDeltas.every(d => d < DIMINISHING_DELTA_THRESHOLD)
  ) {
    return { action: 'stop', reason: 'diminishing_returns' }
  }

  return { action: 'continue' }
}

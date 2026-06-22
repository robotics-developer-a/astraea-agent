// 权限决策审计追踪 — 结构化 DecisionReason（权限与安全总览 §结构化审计）
//
// 每条 allow/deny 决定都携带「为什么」，事后可区分:是规则拒的、模式拒的、红线降级、
// 命令层硬拦、用户手动拒、无人在场 fail-closed、还是记忆子树豁免。7 种 type 1:1 映射
// 代码里的真实决策出口（见 BashTool/index.ts resolveShellPermission 与 fileWriteGate.ts）。

import type { SessionMode } from '../state/sessionMode.js'

/** 决策来源（与代码决策出口 1:1）。 */
export type DecisionReasonType =
  | 'hard-block' // injection-check 命令层硬拦（Defender 规避 / rm -rf / 控制字符…）
  | 'rule' // config/DEFAULT_RULES 命中 deny/allow
  | 'redline' // 敏感路径把 allow 降级为 ask（.git/ .astraea/ shell 配置）
  | 'mode' // 模式取向放行/拦截（forge/cruise allow、orbit/counsel deny 兜底）
  | 'user' // 交互式 y/n/a/d 用户选择
  | 'fail-closed' // 无人在场，ask → deny，绝不阻塞
  | 'memory-exempt' // 记忆子树写豁免

export interface DecisionReason {
  type: DecisionReasonType
  /** 人读补充:命中的规则 pattern、红线路径、硬拦 check#… */
  detail?: string
}

export interface AuditRecord {
  ts: string // ISO 时间戳
  sessionId: string
  tool: string // 'Bash' | 'FileWrite' | 'FileEdit' | …
  target: string // 命令串或文件路径（原文，不脱敏，与 transcript 隐私模型一致）
  behavior: 'allow' | 'deny' // 最终结果（ask 已解析为 allow/deny）
  reason: DecisionReason
  mode: SessionMode // 决策时的会话模式
  interactive: boolean // 是否有交互式用户在场
  remember?: 'always-allow' | 'always-deny' | 'session-cruise' // 用户持久化/会话级放行选择（session-cruise = 文件写切 cruise）
}

/** 决策出口构造时提供的部分;ts + sessionId 由 recordDecision 填充。 */
export type DecisionInput = Omit<AuditRecord, 'ts' | 'sessionId'>

// 文件写权限闸 — FileWrite / FileEdit 共用（Permission & Safety Technical Spec §1.3 + §5）
//
// 判定顺序：
//   1. 模式取向：fileWriteBehavior(mode) → allow / ask / deny
//      （orbit/counsel 的硬拦截在 query.ts 框架层先发生，这里 deny 仅兜底）
//   2. 红线叠加：写敏感路径（.git/ .astraea/ shell 配置）即便 cruise/forge 也把 allow 降级为 ask
//   3. ask 的解析：交互式 → 弹窗确认；非交互（无人在场）→ fail-closed deny，绝不阻塞
//
// 判定与阻塞 I/O 解耦：confirmWithUser 仅在 ctx.isInteractive === true 时调用。

import type { ToolContext } from './Tool.js'
import { fileWriteBehavior } from '../state/sessionMode.js'
import { isSensitivePath } from '../config/redlines.js'
import { isAnyMemoryPath } from '../memory/paths.js'
import { confirmWithUser } from './BashTool/permissions/confirm.js'
import { recordDecision } from '../audit/record.js'
import type { DecisionReason } from '../audit/types.js'

export interface WriteGateResult {
  proceed: boolean
  /** 当 proceed=false 时给出的拒绝说明（写回 ToolCallResult.output）。 */
  rejection?: string
}

/**
 * @param filePath  目标文件绝对路径
 * @param ctx       工具上下文（mode + isInteractive）
 * @param action    动作标签，如 'write' / 'edit' / 'create'，用于提示文案
 */
export async function checkWritePermission(
  filePath: string,
  ctx: ToolContext,
  action: string,
): Promise<WriteGateResult> {
  // 审计:tool 标签由 action 推导（'edit'→FileEdit，其余→FileWrite）。
  const tool = action === 'edit' ? 'FileEdit' : 'FileWrite'
  const interactive = ctx.isInteractive === true
  const audit = (behavior: 'allow' | 'deny', reason: DecisionReason): void =>
    recordDecision({ tool, target: filePath, behavior, reason, mode: ctx.mode, interactive })

  // 定稿 #5：记忆子树写豁免，在红线之前评判。只放行 <base>/projects/<slug>/memory/**，
  // 让 channel A（主代理自写记忆）不弹窗、channel B（后台提取、无人在场）不 fail-closed。
  // settings.json/transcripts/plans 不在此子树，仍走红线，杜绝借记忆通道自我提权。
  if (isAnyMemoryPath(filePath)) {
    audit('allow', { type: 'memory-exempt' })
    return { proceed: true }
  }

  const sensitive = isSensitivePath(filePath)
  const original = fileWriteBehavior(ctx.mode)
  let behavior = original

  // 红线：敏感路径把 allow 降级为 ask（cruise/forge 也不例外）
  const downgraded = sensitive && behavior === 'allow'
  if (downgraded) behavior = 'ask'

  if (behavior === 'allow') {
    audit('allow', { type: 'mode', detail: ctx.mode })
    return { proceed: true }
  }

  if (behavior === 'deny') {
    audit('deny', { type: 'mode', detail: `${ctx.mode} mode forbids writes` })
    return {
      proceed: false,
      rejection: `[${ctx.mode} mode] file ${action} blocked — write operations are not allowed in this mode.`,
    }
  }

  // behavior === 'ask'
  if (!interactive) {
    // 无人在场：fail-closed deny，绝不挂起。归因:redline 降级所致记 redline，否则 fail-closed。
    audit('deny', downgraded ? { type: 'redline', detail: filePath } : { type: 'fail-closed' })
    return {
      proceed: false,
      rejection: `File ${action} requires confirmation, but no interactive user is available (fail-closed deny). ${
        sensitive ? 'This is a sensitive path (red-line). ' : ''
      }Pre-allow it, or run interactively in cruise/forge mode.`,
    }
  }

  const label = `${action} ${filePath}${sensitive ? '   ⚠ sensitive path (red-line)' : ''}`
  const confirm = await confirmWithUser(label)
  const userDetail = sensitive ? 'red-line sensitive path' : undefined
  if (!confirm.proceed) {
    audit('deny', { type: 'user', detail: userDetail })
    return { proceed: false, rejection: `File ${action} cancelled by user.` }
  }
  audit('allow', { type: 'user', detail: userDetail })
  return { proceed: true }
}

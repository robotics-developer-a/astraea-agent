// 权限规则引擎 — 文档 §5 步骤 5 & §6 MVP
// deny/ask/allow 规则，支持精确/前缀/通配符三种匹配

export type RuleAction = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  /** 匹配模式：精确字符串、"prefix:*"（前缀后接任意内容）、含 * 的通配符 */
  pattern: string
  action: RuleAction
}

/**
 * 在 rules 列表中找第一条匹配的规则，返回其 action；
 * 如果没有匹配规则，返回 null（调用方决定默认行为）。
 */
export function matchRule(command: string, rules: PermissionRule[]): RuleAction | null {
  return findMatchingRule(command, rules)?.action ?? null
}

/** 同 matchRule，但返回整条规则（含 pattern），供审计记录'是哪条规则'。 */
export function findMatchingRule(command: string, rules: PermissionRule[]): PermissionRule | null {
  for (const rule of rules) {
    if (commandMatchesPattern(command, rule.pattern)) {
      return rule
    }
  }
  return null
}

function commandMatchesPattern(command: string, pattern: string): boolean {
  // 前缀匹配：pattern 以 ":*" 结尾，如 "git commit:*"
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2)
    return command === prefix || command.startsWith(prefix + ' ')
  }

  // 通配符匹配：pattern 含 *，如 "rm *"
  if (pattern.includes('*')) {
    // 将 * 转为 .* 并构建正则（转义其他正则特殊字符）
    const regexSrc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    const re = new RegExp(`^${regexSrc}$`)
    return re.test(command)
  }

  // 精确匹配
  return command === pattern
}

/** 内置的默认规则集（不含用户自定义规则） */
export const DEFAULT_RULES: PermissionRule[] = [
  // 高危破坏性命令 → 直接拒绝
  { pattern: 'rm -rf /', action: 'deny' },
  { pattern: 'rm -rf /*', action: 'deny' },
  { pattern: 'mkfs:*', action: 'deny' },
  { pattern: 'dd if=:*', action: 'deny' },
  // 修改系统配置 → 需询问
  { pattern: 'sudo:*', action: 'ask' },
  { pattern: 'su:*', action: 'ask' },
  { pattern: 'chmod 777:*', action: 'ask' },
  { pattern: 'chown:*', action: 'ask' },
  // 网络发送 → 需询问
  { pattern: 'curl -X POST:*', action: 'ask' },
  { pattern: 'curl -X PUT:*', action: 'ask' },
  { pattern: 'curl -X DELETE:*', action: 'ask' },
]

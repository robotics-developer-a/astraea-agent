// 注入检测 — 基于文档 §4 的 23 种模式（简化版，覆盖最高危向量）
// 完整版见 claude-code-main: bashSecurity.ts

export interface SecurityResult {
  safe: boolean
  reason?: string
  checkId?: number
}

// 完全阻断：无法在合法命令中出现的模式
const HARD_BLOCK_PATTERNS: Array<{ pattern: RegExp; id: number; msg: string }> = [
  // ID 13: /proc environ 访问
  { pattern: /\/proc\/[^/]*\/environ/, id: 13, msg: '/proc environ access' },
  // ID 17: 控制字符（不可见注入，排除 \t \n \r）
  { pattern: /[\x00-\x08\x0b\x0c\x0e-\x1f]/, id: 17, msg: 'control characters' },
  // ID 18: Unicode 空白伪装（ENSP U+2002, EMSP U+2003, NBSP U+00A0, 全角 U+3000, ZWSP U+200B 等）
  { pattern: /[   -​  　﻿]/, id: 18, msg: 'unicode whitespace spoofing' },
  // ID 11: IFS 变量操控
  { pattern: /\$IFS/, id: 11, msg: 'IFS injection' },
  // ID 23: 引号内换行（差异解析攻击）
  { pattern: /["'][^"']*\n[^"']*["']/, id: 23, msg: 'quoted newline injection' },
]

// 可疑模式（safe:true 但携带 reason，调用方可决定是否询问用户）
const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; id: number; msg: string }> = [
  // ID 8: 命令替换
  { pattern: /\$\(/, id: 8, msg: 'command substitution $()' },
  { pattern: /`[^`]+`/, id: 8, msg: 'backtick command substitution' },
  // ID 8: 进程替换
  { pattern: /<\(/, id: 8, msg: 'process substitution <()' },
  { pattern: />\(/, id: 8, msg: 'process substitution >()' },
  // ID 7: 换行符转义注入
  { pattern: /\\n/, id: 7, msg: 'escaped newline injection' },
  // ID 4: 混淆参数（空引号拼接命令名，如 r''m''）
  { pattern: /[a-zA-Z](?:''|"")[a-zA-Z]/, id: 4, msg: 'obfuscated command via empty quotes' },
  // ID 16: 大括号展开（{a,b} 批量生成）
  { pattern: /\{[^{}]*,[^{}]*\}/, id: 16, msg: 'brace expansion' },
]

// zsh 特有危险命令
const ZSH_DANGEROUS_CMDS = new Set([
  'zmodload', 'emulate', 'sysopen', 'sysread', 'syswrite',
  'zpty', 'ztcp', 'zsocket', 'mapfile',
])

export function checkCommandSecurity(command: string): SecurityResult {
  // 1. 硬阻断检查
  for (const { pattern, id, msg } of HARD_BLOCK_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: msg, checkId: id }
    }
  }

  // 2. zsh 危险命令
  const baseCmd = command.trim().split(/\s+/)[0] ?? ''
  if (ZSH_DANGEROUS_CMDS.has(baseCmd)) {
    return { safe: false, reason: `dangerous zsh command: ${baseCmd}`, checkId: 20 }
  }

  // 3. 可疑模式标记（不阻断，调用方可据此触发确认）
  for (const { pattern, id, msg } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: true, reason: msg, checkId: id }
    }
  }

  return { safe: true }
}

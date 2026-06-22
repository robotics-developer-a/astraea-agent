// 安全红线 — bypass-immune 的敏感目标（Permission & Safety Technical Spec §5）
//
// 设计：连 forge 模式也不能静默放行这些操作。分两层：
//   1. 命令层 HARD_BLOCK（rm -rf /, mkfs, 控制字符…）→ 见 BashTool/security/injection-check.ts
//      （zsh/bash）与 PowerShellTool/security/injection-check.ts（PowerShell：Defender 规避 /
//      下载执行链 / -EncodedCommand 混淆 / 持久化…），在所有模式下先于权限判定执行，永远 deny。
//   2. 路径红线（写 .git/ .astraea/ shell 启动文件…）→ 本模块。命中时即便 forge/cruise
//      也把 allow 降级为 ask（无人在场则 fail-closed deny）。
//
// 理由：写这些路径可改变权限系统本身（.astraea/settings.json）或污染用户环境（.zshrc），
// 是 prompt-injection 攻击的首要目标，因此不可被任何模式或 "Always allow" 学习路径打开。

import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

// 写入即触红线的敏感路径
const SENSITIVE_PATH_REGEXES: RegExp[] = [
  /(^|\/)\.git(\/|$)/, // .git/ 仓库内部
  /(^|\/)\.astraea(\/|$)/, // .astraea/ —— 权限配置自身（防自我提权）
  /(^|\/)\.claude(\/|$)/, // .claude/ —— 兼容
  /(^|\/)\.(zshrc|zprofile|zshenv|zlogin|bashrc|bash_profile|profile)$/, // shell 启动文件
  /(^|\/)\.config\/(fish|powershell)(\/|$)/,
]

/** 写入该路径是否触碰红线（用于 FileWrite/FileEdit 的目标路径）。 */
export function isSensitivePath(path: string): boolean {
  if (!path) return false
  const p = resolveThroughExistingAncestors(path).replace(/\\/g, '/')
  return SENSITIVE_PATH_REGEXES.some((re) => re.test(p))
}

function resolveThroughExistingAncestors(input: string): string {
  let current = resolve(input)
  const missing: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return resolve(input)
    missing.unshift(basename(current))
    current = parent
  }
  try {
    return join(realpathSync.native(current), ...missing)
  } catch {
    return resolve(input)
  }
}

// 命令串中出现这些标记即保守视为"触碰敏感路径"。
// 仅对非只读命令生效（只读命令在 BashTool 已先行放行），故 `cat .git/config` 不受影响。
const COMMAND_SENSITIVE_TOKENS: RegExp[] = [
  /\.git(\/|\b)/,
  /\.astraea(\/|\b)/,
  /\.claude(\/|\b)/,
  /\.(zshrc|zprofile|zshenv|zlogin|bashrc|bash_profile|profile)\b/,
]

/** 非只读命令是否触碰敏感路径 → 即便 forge 也强制确认。 */
export function commandTouchesSensitivePath(command: string): boolean {
  if (!command) return false
  return COMMAND_SENSITIVE_TOKENS.some((re) => re.test(command))
}

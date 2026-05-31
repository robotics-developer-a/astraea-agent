// 权限配置文件读写
// 项目级：<cwd>/.astraea/settings.json（优先）
// 全局级：~/.astraea/settings.json（兜底）
//
// 文件格式:
// {
//   "permissions": {
//     "allow": ["bun install", "git fetch:*"],
//     "deny":  ["git push origin main --force"],
//     "ask":   ["git push:*", "npm publish:*"]
//   }
// }

import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import type { PermissionRule } from '../tools/BashTool/permissions/permission-rules.js'

interface PermissionsSection {
  allow?: string[]
  deny?: string[]
  ask?: string[]
}

interface AstraeaSettings {
  permissions?: PermissionsSection
}

export const CONFIG_DIR = '.astraea'
export const CONFIG_FILE = 'settings.json'

export function projectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR, CONFIG_FILE)
}

export function globalConfigPath(): string {
  return join(homedir(), CONFIG_DIR, CONFIG_FILE)
}

async function readConfig(path: string): Promise<AstraeaSettings> {
  try {
    const text = await Bun.file(path).text()
    return JSON.parse(text) as AstraeaSettings
  } catch {
    return {}
  }
}

/**
 * 从项目 + 全局配置合并权限规则，项目级优先。
 * 规则顺序：deny → ask → allow（保守优先）
 */
export async function loadPermissionRules(cwd: string): Promise<PermissionRule[]> {
  const [project, global] = await Promise.all([
    readConfig(projectConfigPath(cwd)),
    readConfig(globalConfigPath()),
  ])

  const merged: Required<PermissionsSection> = {
    deny:  [...(project.permissions?.deny  ?? []), ...(global.permissions?.deny  ?? [])],
    ask:   [...(project.permissions?.ask   ?? []), ...(global.permissions?.ask   ?? [])],
    allow: [...(project.permissions?.allow ?? []), ...(global.permissions?.allow ?? [])],
  }

  return [
    ...merged.deny.map((pattern) => ({ pattern, action: 'deny'  as const })),
    ...merged.ask .map((pattern) => ({ pattern, action: 'ask'   as const })),
    ...merged.allow.map((pattern) => ({ pattern, action: 'allow' as const })),
  ]
}

/**
 * 将一条新规则追加写入项目配置文件。
 * 如果 .astraea/ 目录不存在则自动创建。
 * 重复写入同一 pattern 时幂等跳过。
 */
export async function appendPermissionRule(
  cwd: string,
  pattern: string,
  action: 'allow' | 'deny',
): Promise<void> {
  const path = projectConfigPath(cwd)
  const existing = await readConfig(path)

  if (!existing.permissions) existing.permissions = {}
  const list = existing.permissions[action] ?? []

  if (list.includes(pattern)) return  // 已存在，幂等

  existing.permissions[action] = [...list, pattern]

  mkdirSync(join(cwd, CONFIG_DIR), { recursive: true })
  await Bun.write(path, JSON.stringify(existing, null, 2) + '\n')
}

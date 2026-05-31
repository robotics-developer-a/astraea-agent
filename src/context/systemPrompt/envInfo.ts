// 动态段：环境信息（CWD、git状态、OS、Shell、模型名）
// 每次会话初始化时计算一次，/clear 后重算

import { type as osType, release as osRelease } from 'os'

function getOsVersion(): string {
  return `${osType()} ${osRelease()}`
}

function getShell(): string {
  const shell = process.env.SHELL ?? 'unknown'
  if (shell.includes('zsh'))  return 'zsh'
  if (shell.includes('bash')) return 'bash'
  return shell
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const result = await Bun.$`git -C ${cwd} rev-parse --is-inside-work-tree`.quiet()
    return result.exitCode === 0
  } catch {
    return false
  }
}

export async function computeEnvInfo(modelId: string): Promise<string> {
  const cwd = process.cwd()
  const isGit = await isGitRepo(cwd)
  const platform = process.platform

  const items = [
    `Primary working directory: ${cwd}`,
    `Is a git repository: ${isGit ? 'Yes' : 'No'}`,
    `Platform: ${platform}`,
    `Shell: ${getShell()}`,
    `OS Version: ${getOsVersion()}`,
    `Model: ${modelId}`,
  ]

  return ['# Environment', ...items.map(i => ` - ${i}`)].join('\n')
}

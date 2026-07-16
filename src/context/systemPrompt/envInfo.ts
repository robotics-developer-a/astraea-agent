// 动态段：环境信息（CWD、git状态、OS、Shell、模型名）
// 每次会话初始化时计算一次；/login 换模型后必须重算（见 builder 对 env_info 的 invalidate）。

import { type as osType, release as osRelease } from 'os'
import { activeBaseUrl, config } from '../../config'

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
  const provider = config.provider
  const endpoint = activeBaseUrl()

  const items = [
    `Primary working directory: ${cwd}`,
    `Is a git repository: ${isGit ? 'Yes' : 'No'}`,
    `Platform: ${platform}`,
    `Shell: ${getShell()}`,
    `OS Version: ${getOsVersion()}`,
    // Authoritative runtime channel — models often self-identify as Claude/GPT from training.
    // When the user asks which model is in use, answer ONLY from these fields.
    `Provider: ${provider}`,
    `Model: ${modelId}`,
    `Endpoint: ${endpoint}`,
  ]
  if (provider === 'custom') {
    items.push(`API style: ${config.custom.apiStyle}`)
  }

  return [
    '# Environment',
    ...items.map(i => ` - ${i}`),
    '',
    'When asked which model, provider, or API you are using, report the Provider / Model / Endpoint',
    'lines above exactly. Do not claim to be Claude, GPT, Gemini, or any other model family unless',
    'the Model line above matches that name. You are Astraea running on the configured channel.',
  ].join('\n')
}

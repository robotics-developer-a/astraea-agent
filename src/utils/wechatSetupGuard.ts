import { spawnSync } from 'node:child_process'

const WECHAT_KEYWORDS = ['wechat', '微信', 'wechattool', 'wechatread', 'wechatwrite']

export function promptNeedsWechat(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  return WECHAT_KEYWORDS.some(kw => lower.includes(kw))
}

function isInstalled(): boolean {
  // 检查 pyobjc 核心框架（AppKit、Quartz、Vision 均来自 pyobjc）
  return spawnSync('python3', ['-c', 'import AppKit, Quartz, Vision'], { encoding: 'utf-8' }).status === 0
}

/**
 * 确保 pyobjc 已安装（WechatReadTool 的运行依赖）。
 * 未安装时自动执行 pip3 install，安装失败才返回错误信息。
 */
export function checkWechatSetup(): string | null {
  if (isInstalled()) return null

  // 自动安装
  const install = spawnSync('pip3', ['install', 'pyobjc', '--quiet'], { encoding: 'utf-8' })
  if (install.status !== 0 || !isInstalled()) {
    return [
      'WechatReadTool 依赖（pyobjc）自动安装失败，请手动运行：',
      '  pip3 install pyobjc',
    ].join('\n')
  }

  return null
}

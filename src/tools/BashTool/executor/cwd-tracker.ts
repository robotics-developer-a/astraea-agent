// CWD 追踪 — 跨 Bash 调用保持工作目录状态
// 原理：每次命令结束后把当前目录写入临时文件，下次调用时读取并作为 cwd 传给 spawn

import { join } from 'path'
import { tmpdir } from 'os'

const CWD_FILE = join(tmpdir(), `.astraea_cwd_${process.pid}`)

// 模块内唯一的"当前目录"状态
let _currentCwd: string = process.cwd()

export function getCurrentCwd(): string {
  return _currentCwd
}

/**
 * 在原始命令外包装一层：命令结束后把 pwd 写入追踪文件。
 * 保留原始退出码。
 */
export function wrapWithCwdTracking(command: string): string {
  const file = JSON.stringify(CWD_FILE)
  // 用子 shell 包住，防止 exit 提前退出追踪逻辑
  return `( ${command} ); __astraea_exit=$?; pwd > ${file} 2>/dev/null; exit $__astraea_exit`
}

/**
 * 命令执行完毕后调用，将追踪文件中的新目录同步到模块状态。
 */
export async function syncCwd(): Promise<void> {
  try {
    const content = await Bun.file(CWD_FILE).text()
    const cwd = content.trim()
    if (cwd) _currentCwd = cwd
  } catch {
    // 文件不存在或读取失败时保持现有 CWD
  }
}

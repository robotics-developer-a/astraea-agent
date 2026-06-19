// 跨平台读取系统剪贴板文本。
//
// 为什么需要它：在部分 Windows 终端（经典 conhost / PowerShell 控制台）里，按 Ctrl+V
// 并不会触发终端的「粘贴」动作，而是把原始控制字节 \x16（Ctrl+V）直接发给程序——
// 既不会走 bracketed-paste（usePaste 收不到），也不会以普通文本块到达 useInput。
// 于是我们拦截 Ctrl+V 这个按键，主动去读系统剪贴板，把内容插进输入框。
//
// 各平台用各自自带的命令读取剪贴板，零额外依赖：
//   - Windows: powershell Get-Clipboard
//   - macOS:   pbpaste
//   - Linux:   wl-paste（Wayland）/ xclip / xsel（X11），按可用性回退

import { platform } from 'node:os'

async function run(cmd: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode !== 0) return null
    return text
  } catch {
    // 命令不存在（ENOENT）等 → 视为读取失败，交给上层回退
    return null
  }
}

/**
 * 读取系统剪贴板的纯文本。读不到时返回空字符串（绝不抛错，避免影响输入流程）。
 */
export async function readClipboard(): Promise<string> {
  const os = platform()

  if (os === 'win32') {
    // -Raw 保留换行、不在末尾补多余换行；Get-Clipboard 默认会按行返回再被 join。
    const out = await run([
      'powershell',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-Clipboard -Raw',
    ])
    // PowerShell 常在末尾附带一个 CRLF，去掉它（保留正文内部换行）。
    return (out ?? '').replace(/\r\n$/, '').replace(/\r/g, '')
  }

  if (os === 'darwin') {
    return (await run(['pbpaste'])) ?? ''
  }

  // Linux / 其它 *nix：依次尝试 wl-paste → xclip → xsel
  const candidates: string[][] = [
    ['wl-paste', '--no-newline'],
    ['xclip', '-selection', 'clipboard', '-o'],
    ['xsel', '--clipboard', '--output'],
  ]
  for (const cmd of candidates) {
    const out = await run(cmd)
    if (out !== null) return out
  }
  return ''
}

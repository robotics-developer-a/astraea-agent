// 终端崩溃护栏 —— 任何未捕获的异常 / 未处理的 Promise 拒绝都不该把终端「锁死」。
//
// 背景：Ink 接管终端后会进入 raw mode、隐藏光标（ESC[?25l）、开启 bracketed-paste
// （ESC[?2004h）与同步渲染（ESC[?2026h）。这些状态在 Ink 正常 unmount 时会被还原，
// 但若进程因「React 树之外」的错误骤然退出——例如流式管线外的 fire-and-forget 回调
// （resize 监听、`void initMcp()`、setInterval、UDS server、子进程事件）抛错——Ink 的
// 卸载清理根本不会跑：光标仍隐藏、stdin 仍 raw、bracketed-paste 仍开 → 用户的 shell
// 看起来「整个终端崩溃 / 卡死」（无回显、无光标、粘贴行为异常）。
//
// 本模块在 render() 之前装一层进程级护栏：崩溃时先把上述终端状态逐一复位，再打印错误
// 并干净退出，保证「就算崩，也别把终端一起带走」。复位序列全部幂等，与 Ink 自身的清理
// 叠加无副作用。

import { openSync, writeSync } from 'node:fs'

// 复位序列（按「关私有模式 → 显光标」顺序）：
//   ESC[?2026l 关同步渲染、ESC[?2004l 关 bracketed-paste、ESC[?1000/1002/1003/1006l 关鼠标
//   上报（如有开启）、ESC[?25h 显光标、ESC[0m 清属性。
const RESTORE_SEQ =
  '\x1b[?2026l' + '\x1b[?2004l' + '\x1b[?1000l' + '\x1b[?1002l' + '\x1b[?1003l' + '\x1b[?1006l' + '\x1b[?25h' + '\x1b[0m'

// 直写控制终端 /dev/tty —— 与 terminalTitle 同策略：绕开 bun/Ink 对 stdout 的中转，
// 即使 stdout 被重定向也能复位真终端。打不开则回退 stdout。
let ttyFd: number | null | undefined
function ttyWrite(seq: string): boolean {
  if (ttyFd === undefined) {
    try { ttyFd = openSync('/dev/tty', 'w') } catch { ttyFd = null }
  }
  if (ttyFd === null) return false
  try { writeSync(ttyFd, seq); return true } catch { return false }
}

let restored = false

/**
 * 把终端从 Ink 接管的状态复位回正常 shell 可用状态。幂等：多次调用安全，且与 Ink 自身
 * 的卸载清理叠加无副作用。崩溃护栏与正常退出路径都可调用。
 */
export function restoreTerminal(): void {
  if (restored) return
  restored = true
  // 先退 raw mode（让 stdin 恢复行缓冲 + 回显），再写复位转义。
  try {
    const stdin = process.stdin as NodeJS.ReadStream
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false)
  } catch { /* 个别环境 setRawMode 不可用 */ }
  if (!ttyWrite(RESTORE_SEQ)) {
    try { if (process.stdout.isTTY) process.stdout.write(RESTORE_SEQ) } catch { /* ignore */ }
  }
}

/**
 * 装进程级崩溃护栏：未捕获异常 / 未处理拒绝时，先复位终端再打印错误并退出（exit 1）。
 * 必须在 Ink 的 render() 之前调用。信号（SIGINT/SIGTERM）交给 Ink 自身处理，不重复接管。
 */
export function installCrashGuard(): void {
  const onFatal = (label: string) => (err: unknown) => {
    restoreTerminal()
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
    try { process.stderr.write(`\n${label}: ${msg}\n`) } catch { /* ignore */ }
    process.exit(1)
  }
  process.on('uncaughtException', onFatal('Uncaught exception'))
  process.on('unhandledRejection', onFatal('Unhandled rejection'))
}

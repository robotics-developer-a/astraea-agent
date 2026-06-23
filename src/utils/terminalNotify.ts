// 终端完成通知 —— 任务跑完时「提示用户去看一眼」（Dock 弹一下 / 任务栏闪一下 / 通知中心横幅）。
//
// 参考 claude-code 的 notifier.ts + useTerminalNotification：核心机制是终端响铃 BEL(\x07)，
// 外加各家终端的原生富通知 OSC。Astraea 复用 terminalTitle.ts 的「直写 /dev/tty + tmux/screen
// DCS 包裹」基建（绕开 Ink/bun 对 stdout 的缓冲，实测裸写 stdout 不生效）。
//
// 为什么 BEL 天然「不打扰」：macOS 只在「终端不在前台」时才把 Dock 图标点亮成红色角标「1」，
// Windows Terminal 也只在后台时闪任务栏——用户正盯着看时它几乎无感。所以默认每次完成都响，
// 由操作系统的前/后台判定来决定要不要真的弹出来，这正是用户截图里那个「红色 1」的来源。

import { platform } from 'node:os'
import { openSync, writeSync } from 'node:fs'
import { getSettings } from '../settings'

const IS_WIN = platform() === 'win32'
const BEL = '\x07'
const ESC = '\x1b'
const ST = ESC + '\\' // OSC 字符串终止符（kitty 用它收尾以免额外蜂鸣）

// ─── 多路复用器透传（与 terminalTitle 同款）───────────────────────────────────
// tmux/screen 会吞裸 OSC，必须用 DCS 包裹转发给外层真终端。但 BEL 绝不能包：裸 \x07 才能
// 触发 tmux 的 bell-action（窗口标记位）；包进 DCS 后 tmux 看不到这声响铃。
const IN_TMUX = !!process.env['TMUX'] || (process.env['TERM'] ?? '').startsWith('tmux')
const IN_SCREEN = !IN_TMUX && ((process.env['TERM'] ?? '').startsWith('screen') || !!process.env['STY'])
function wrapMux(seq: string): string {
  if (IN_TMUX) return `${ESC}Ptmux;${seq.replace(/\x1b/g, '\x1b\x1b')}${ESC}\\`
  if (IN_SCREEN) return `${ESC}P${seq}${ESC}\\`
  return seq
}

// ─── 直写真终端 /dev/tty（fd 缓存一次；打不开则回退 stdout）──────────────────────
let ttyFd: number | null | undefined
function ttyWrite(seq: string): boolean {
  if (ttyFd === undefined) {
    try { ttyFd = openSync('/dev/tty', 'w') } catch { ttyFd = null }
  }
  if (ttyFd === null) return false
  try { writeSync(ttyFd, seq); return true } catch { return false }
}
function emit(seq: string): void {
  if (!ttyWrite(seq) && process.stdout.isTTY) process.stdout.write(seq)
}

// ─── 终端探测：决定 auto 通道走哪种富通知 ─────────────────────────────────────
export type Term = 'iterm2' | 'kitty' | 'ghostty' | 'apple' | 'other'
export function detectTerm(): Term {
  const tp = process.env['TERM_PROGRAM'] ?? ''
  const term = process.env['TERM'] ?? ''
  if (tp === 'iTerm.app') return 'iterm2'
  if (tp === 'ghostty' || !!process.env['GHOSTTY_RESOURCES_DIR']) return 'ghostty'
  if (tp === 'WezTerm') return 'iterm2' // WezTerm 兼容 iTerm2 的 OSC 9
  if (!!process.env['KITTY_WINDOW_ID'] || term === 'xterm-kitty') return 'kitty'
  if (tp === 'Apple_Terminal') return 'apple'
  return 'other'
}

// ─── 富通知序列构造（OSC 编号与 claude-code 一致）────────────────────────────────
const sanitize = (s: string): string => s.replace(/[\x00-\x1f;]/g, ' ').trim()

// iTerm2 / WezTerm：OSC 9 —— 弹 macOS 通知中心横幅（终端在前台时自动抑制）。
function oscIterm2(message: string): string {
  return `${ESC}]9;${sanitize(message)}${BEL}`
}
// kitty：OSC 99 桌面通知协议（单条 body，ST 收尾）。
function oscKitty(message: string): string {
  return `${ESC}]99;;${sanitize(message)}${ST}`
}
// Ghostty：OSC 777;notify;title;body。
function oscGhostty(title: string, message: string): string {
  return `${ESC}]777;notify;${sanitize(title)};${sanitize(message)}${BEL}`
}

// ─── 配置 ─────────────────────────────────────────────────────────────────────
export type NotifyChannel = 'auto' | 'bell' | 'iterm2' | 'kitty' | 'ghostty' | 'off'
interface ResolvedNotify {
  enabled: boolean
  channel: NotifyChannel
  minDurationMs: number
  sound: boolean
}
function resolveNotify(): ResolvedNotify {
  const n = getSettings().notify ?? {}
  return {
    enabled: n.enabled !== false,                       // 默认开
    channel: (n.channel as NotifyChannel) ?? 'auto',    // 默认 auto
    minDurationMs: Math.max(0, n.minDurationMs ?? 0),   // 默认每次完成都响
    sound: n.sound === true,                            // 富通知是否额外补一声 BEL，默认否
  }
}

const BRAND = 'Astraea'

// 实际写出一条通知。channel='off' 或测试环境直接跳过。
function send(title: string, message: string): void {
  if (process.env['NODE_ENV'] === 'test') return
  const cfg = resolveNotify()
  if (!cfg.enabled || cfg.channel === 'off') return

  // Windows：终端无 OSC 富通知生态，统一走 BEL（Windows Terminal 后台闪任务栏 / 弹角标）。
  if (IS_WIN) { emit(BEL); return }

  let channel: NotifyChannel = cfg.channel
  if (channel === 'auto') {
    const term = detectTerm()
    channel = term === 'apple' || term === 'other' ? 'bell' : term
  }

  const display = title ? `${title} — ${message}` : message
  switch (channel) {
    case 'bell':
      emit(BEL)
      return
    case 'iterm2':
      emit(wrapMux(oscIterm2(display)))
      break
    case 'kitty':
      emit(wrapMux(oscKitty(display)))
      break
    case 'ghostty':
      emit(wrapMux(oscGhostty(title || BRAND, message)))
      break
  }
  // 富通知通道按需补一声响铃（Dock 弹跳 + 通知中心横幅同时要）。
  if (cfg.sound) emit(BEL)
}

// ─── 对外 API ─────────────────────────────────────────────────────────────────

/** 本轮干净收尾 → 通知用户「任务完成」。elapsedMs 用于 minDurationMs 门控。 */
export function notifyTaskDone(opts: { elapsedMs?: number; summary?: string } = {}): void {
  const cfg = resolveNotify()
  if (!cfg.enabled) return
  if ((opts.elapsedMs ?? 0) < cfg.minDurationMs) return
  send(BRAND, opts.summary?.trim() || 'Task complete')
}

/** 本轮报错 → 通知用户「任务出错，去看一眼」。同样受 minDurationMs 门控。 */
export function notifyTaskError(opts: { elapsedMs?: number; summary?: string } = {}): void {
  const cfg = resolveNotify()
  if (!cfg.enabled) return
  if ((opts.elapsedMs ?? 0) < cfg.minDurationMs) return
  send(BRAND, opts.summary?.trim() || 'Task failed — needs your attention')
}

/** 权限确认正在等待用户选择 → 立即提示用户回来处理，不受任务耗时门控。 */
export function notifyPermissionRequest(opts: { summary?: string } = {}): void {
  const cfg = resolveNotify()
  if (!cfg.enabled) return
  send(BRAND, opts.summary?.trim() || 'Permission needed — choose allow or deny')
}

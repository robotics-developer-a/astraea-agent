// 终端窗口标题栏 —— 把「状态星 + 目录 · 任务摘要」写到 macOS 红黄绿交通灯右边那条标题栏。
//
// 参考 claude-code 的 useTerminalTitle（OSC 0 设标题 / Windows 回落 process.title），但
// Astraea 的创意在「状态」表达上：标题栏是纯文本、无颜色，于是用品牌星家族做一台「状态星
// 字符机」——空闲 ◌ / 辐中 ✸ / 完成 ✓ / 出错 ✗（grill 决议 Q4，无定时器、无动画 Q5）。
//
// 摘要走两段式（titleSummary.ts）：任务起跑先用用户原话「即时」填标题（零延迟），后台再用
// 主模型精炼成一句极短短语「静静替换」（grill 决议 Q2）。本模块只管状态机与 OSC 写出；
// 异步 LLM 调用与回填竞态由 activeTurn 守卫。

import { homedir, platform } from 'node:os'
import { sep } from 'node:path'
import { openSync, writeSync } from 'node:fs'
import { stringDisplayWidth } from './termWidth'

const IS_WIN = platform() === 'win32'

// OSC 0 = 同时设「窗口标题 + 图标名」，BEL(\x07) 收尾，全终端通用。
const OSC_SET = '\x1b]0;'
const BEL = '\x07'

// 多路复用器透传：tmux/screen 会吞掉裸 OSC，必须用 DCS 包裹才会转发给外层真终端。
const IN_TMUX = !!process.env['TMUX'] || (process.env['TERM'] ?? '').startsWith('tmux')
const IN_SCREEN = !IN_TMUX && (process.env['TERM'] ?? '').startsWith('screen')
function wrapMux(seq: string): string {
  if (IN_TMUX) return `\x1bPtmux;${seq.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`
  if (IN_SCREEN) return `\x1bP${seq}\x1b\\`
  return seq
}

// 直写控制终端 /dev/tty —— 绕开 bun/Ink 对 process.stdout 的中转与缓冲（实测裸写 stdout
// 在本机不生效）。fd 缓存一次；打不开(无控制终端 / CI)则回退 stdout。
let ttyFd: number | null | undefined
function ttyWrite(seq: string): boolean {
  if (ttyFd === undefined) {
    try { ttyFd = openSync('/dev/tty', 'w') } catch { ttyFd = null }
  }
  if (ttyFd === null) return false
  try { writeSync(ttyFd, seq); return true } catch { return false }
}

// 把一段标题文本写到真终端。Windows 走 process.title；其余优先 /dev/tty，再退 stdout，
// 并兜底设 process.title（覆盖终端「活动进程名」组件里残留的 bun … ）。
function emit(text: string): void {
  if (IS_WIN) { process.title = text; return }
  const seq = wrapMux(OSC_SET + text + BEL)
  if (!ttyWrite(seq) && process.stdout.isTTY) process.stdout.write(seq)
  try { process.title = text } catch { /* 个别环境 process.title 只读 */ }
}

// 状态星：复用 REPL turn 头/AstraeaGoddess 的品牌星家族。纯字符（标题栏不支持 SGR 颜色）。
export const TITLE_GLYPH = {
  idle: '◌',   // 空闲：启动 / /clear 后
  busy: '✸',   // 辐中：本轮流式进行中（与 turn 头前导星同形）
  done: '✓',   // 完成：本轮干净收尾（保持到下一任务，grill 决议 Q9）
  error: '✗',  // 出错：本轮异常 / 报错
} as const

const BRAND = 'Astraea'
const SUMMARY_MAX = 24   // 摘要显示宽度上限（极短短语，CJK 计 2 列）
const TITLE_MAX = 80     // 整条标题硬上限，避免个别终端从中间硬截断

// 去 ANSI（标题栏纯文本；用户输入 / LLM 输出偶含 SGR 转义）。不引 strip-ansi（仅 devDep）。
const ANSI_RE = /\x1b\[[0-9;]*m/g
const plain = (s: string): string => s.replace(ANSI_RE, '')

// 按显示宽度做尾部省略（CJK 宽字符计 2 列），保证不把宽字符切半。
function truncWidth(s: string, max: number): string {
  if (stringDisplayWidth(s) <= max) return s
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = stringDisplayWidth(ch)
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return out + '…'
}

// cwd → 「~ 折叠 + 末两段」（grill 决议 Q6）：保留上级目录线索又不吃满标题宽度。
// 例：~/Documents/project/astraea/astraea → …/astraea/astraea；home → ~；/usr/local → /usr/local
export function formatTitleDir(cwd: string): string {
  const home = homedir()
  let p = cwd
  if (p === home) return '~'
  if (p.startsWith(home + sep)) p = '~' + sep + p.slice(home.length + sep.length)
  const segs = p.split(sep).filter(Boolean)
  if (segs.length > 2) return '…/' + segs.slice(-2).join('/')
  // 短路径：~ 开头原样拼回；绝对路径补回前导根；相对路径直接拼。
  if (segs[0] === '~') return segs.join('/')
  return (cwd.startsWith(sep) ? '/' : '') + segs.join('/')
}

// 用户输入 → 即时摘要：剥 system-reminder / 本地命令包裹、折单行、去 ANSI、trim。
export function cleanPromptForTitle(text: string): string {
  return plain(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/g, '')
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── 状态机（模块级单例：整个进程一条标题）──────────────────────────────────────
let dir = formatTitleDir(process.cwd())
let glyph: string = TITLE_GLYPH.idle
let summary = BRAND
// 单调递增 turn id：每次起跑 / 转空闲都 ++，作废任何在途的异步摘要回填（竞态守卫）。
let turnSeq = 0
let activeTurn = 0

function write(): void {
  const body = `${glyph} ${dir} · ${summary}`
  emit(truncWidth(plain(body), TITLE_MAX))
}

/** 启动时铺一条空闲标题。 */
export function initTitle(cwd = process.cwd()): void {
  dir = formatTitleDir(cwd)
  glyph = TITLE_GLYPH.idle
  summary = BRAND
  write()
}

/** 任务起跑：✸ + 即时输入摘要。返回本轮 turn id（供 done/error/异步回填配对）。 */
export function titleStartTask(promptText: string, cwd = process.cwd()): number {
  dir = formatTitleDir(cwd)
  glyph = TITLE_GLYPH.busy
  const instant = cleanPromptForTitle(promptText)
  summary = instant ? truncWidth(instant, SUMMARY_MAX) : BRAND
  activeTurn = ++turnSeq
  write()
  return activeTurn
}

/** 后台精炼摘要回填：仅当仍是当前轮才替换（防止慢摘要盖掉已开始的新任务）。 */
export function titleUpgradeSummary(turn: number, refined: string): void {
  if (turn !== activeTurn) return
  const s = cleanPromptForTitle(refined)
  if (!s) return
  summary = truncWidth(s, SUMMARY_MAX)
  write()
}

/** 本轮干净收尾：✓（摘要保持不变，留到下一任务，grill 决议 Q9）。 */
export function titleTaskDone(turn: number): void {
  if (turn !== activeTurn) return
  glyph = TITLE_GLYPH.done
  write()
}

/** 本轮异常：✗（摘要保留，便于看出刚刚在做什么时出的错）。 */
export function titleTaskError(turn: number): void {
  if (turn !== activeTurn) return
  glyph = TITLE_GLYPH.error
  write()
}

/** 回到空闲（/clear）：◌ + 品牌名，并作废任何在途异步摘要。 */
export function titleIdle(cwd = process.cwd()): void {
  dir = formatTitleDir(cwd)
  glyph = TITLE_GLYPH.idle
  summary = BRAND
  activeTurn = ++turnSeq
  write()
}

/** 用户显式命名会话：空闲态显示该标题，并作废在途自动摘要回填。 */
export function titleCustom(title: string, cwd = process.cwd()): void {
  dir = formatTitleDir(cwd)
  glyph = TITLE_GLYPH.idle
  const clean = cleanPromptForTitle(title)
  summary = clean ? truncWidth(clean, SUMMARY_MAX) : BRAND
  activeTurn = ++turnSeq
  write()
}

/**
 * 退出时落一条干净的品牌标题。
 * 注意：不能写「空标题」——空标题会让终端回落去显示前台命令行（bun ~/.bun/bin/astraea），
 * 反而更难看。所以退出后留一个安静的 "Astraea"。
 */
export function clearTitle(): void {
  emit(BRAND)
}

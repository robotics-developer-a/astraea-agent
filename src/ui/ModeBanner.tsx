// ModeBanner — 模式横幅组件
//
// ModeInputFrame:  把输入框包进一圈手绘的四边矩形框（┌─┐│└─┘），模式标签嵌在上边框中央。
//                  之所以「手绘」而不用 Ink 的 <Box borderStyle>：Ink 的边框整圈只能单色，
//                  做不了逐字符的彩色跑马灯。手绘后我们能给周长上每一格单独上色，于是：
//                    · 任务进行中（running）→ 一段品牌色渐变（靛蓝→星辉→琴琶）带拖尾，
//                      沿矩形周长顺时针流动（彗星跑马灯）。
//                    · 任务刚结束（running: true→false）→ 一道更亮更快的星辉彗星带 ✦/✧
//                      星符沿同一圈快速扫一圈（~800ms），扫完落回模式色静态边框。
//                    · 空闲 → 完全静止的模式色边框，零定时器、零额外重绘。
// ModeSwitchBanner: 写入 history 的一次性切换记录（scrollback 里可查）

import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useWindowSize, measureElement, type DOMElement } from 'ink'
import type { SessionMode } from '../state/sessionMode'
import { INDIGO, SILVER, AMBER } from './theme'

export const MODE_META: Record<SessionMode, {
  label: string
  tagline: string
  color: string
  dim: boolean
}> = {
  orbit:   { label: 'orbit',   tagline: 'blueprint mode — file writes blocked',           color: 'cyan',    dim: false },
  cruise:  { label: 'cruise',  tagline: 'autopilot mode — edits auto-accepted, shell asks', color: 'green',  dim: false },
  forge:   { label: 'forge',   tagline: 'execution mode — all changes auto-accepted',     color: 'yellow',  dim: false },
  counsel: { label: 'counsel', tagline: 'dialogue mode — confirm approach before acting', color: 'magenta', dim: false },
  default: { label: 'default', tagline: 'standard mode',                                  color: 'gray',    dim: true  },
}

// ── 颜色工具（生成彗星渐变 ramp）─────────────────────────────────────────────
function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}
function dimHex(h: string, f: number): string {
  const [r, g, b] = hexToRgb(h)
  return rgbToHex(r * f, g * f, b * f)
}
// 把若干色标（head→tail）展开成长度 len 的彗星拖尾：沿途插值 + 越往尾越暗。
function buildRamp(stops: string[], len: number, dimMax: number): string[] {
  const out: string[] = []
  for (let i = 0; i < len; i++) {
    const t = len === 1 ? 0 : i / (len - 1)          // 0=彗星头 .. 1=尾
    const seg = t * (stops.length - 1)
    const idx = Math.min(stops.length - 2, Math.floor(seg))
    const local = seg - idx
    out.push(dimHex(lerpHex(stops[idx]!, stops[idx + 1]!, local), 1 - dimMax * t))
  }
  return out
}

// 进行中跑马灯：星辉高光 → 靛蓝 → 琴琶的品牌渐变彗星，长 16 格、尾部渐暗。
const MARQUEE_RAMP = buildRamp(['#EAF2FF', SILVER, INDIGO, AMBER], 16, 0.78)
// 结束闪光：更亮（接近纯白头）、更短、收尾不那么暗的彗星，头部叠 ✦/✧ 星符。
const FLASH_RAMP = buildRamp(['#FFFFFF', '#EAF2FF', SILVER, INDIGO], 10, 0.5)

const MARQUEE_TICK = 100   // 跑马灯帧间隔（ms）
const FLASH_TICK   = 50    // 闪光帧间隔（ms）
const FLASH_MS     = 800   // 闪光总时长（约扫一圈）
const SPARKLES     = ['✦', '✧']

// 打字呼吸辉光：每次按键边框整体亮成品牌靛蓝，GLOW_MS 内渐隐回模式色。仅非流式时生效。
const GLOW_MS     = 420    // 一次按键辉光的衰减时长
const GLOW_TICK   = 60     // 辉光衰减重绘帧间隔
const GLOW_BRIGHT = '#9C8CFF' // 辉光峰值色（亮靛蓝）
// 模式静态色的 hex 近似 —— 仅供辉光「模式色 ↔ 亮靛蓝」插值用（静态边框仍用具名色，保留各终端熟悉观感）。
const MODE_HEX: Record<SessionMode, string> = {
  orbit:   '#22c3d6',
  cruise:  '#3cb043',
  forge:   '#d4c020',
  counsel: '#c060c0',
  default: '#808080',
}

// ── 输入框四边手绘框 ────────────────────────────────────────────────────────
interface ModeInputFrameProps {
  mode: SessionMode
  running?: boolean          // 任务进行中（isStreaming）→ 跑马灯；其 true→false 转变触发闪光
  value?: string             // 当前输入框文本：每次变化（非流式时）触发一次打字呼吸辉光
  children: React.ReactNode
}

interface Cell { ch: string; color: string; dim: boolean; bold: boolean }

export function ModeInputFrame({ mode, running = false, value, children }: ModeInputFrameProps) {
  const { columns } = useWindowSize()
  // 用 cols-1 而非 cols：占满整行宽度的字符串在 Windows 终端会触发自动换行、多占一行物理行，
  // Ink 重绘时按逻辑行数回退光标却少算这行，导致上一帧没被擦掉、边框一层层堆叠。留 1 列即避免。
  const cols = Math.max(8, (columns ?? 80) - 1)
  const meta = MODE_META[mode]

  // 内容实际高度（输入行 + 可选的 SlashHint/GoalHint/Esc 提示），决定左右 │ 画几行。
  const contentRef = useRef<DOMElement | null>(null)
  const [contentH, setContentH] = useState(1)
  useEffect(() => {
    if (!contentRef.current) return
    const { height } = measureElement(contentRef.current)
    if (height > 0 && height !== contentH) setContentH(height)
  })

  // 动画状态：offset = 彗星头当前所在的「周长格」位置；flashing = 正在播放结束闪光。
  const [offset, setOffset] = useState(0)
  const [flashing, setFlashing] = useState(false)
  const prevRunning = useRef(running)
  const flashStartRef = useRef(0)
  const pRef = useRef(1)      // 当前周长（供定时器内读取最新值，避免过期闭包）

  // 打字呼吸辉光：typedAt = 最近一次按键时刻；glowTick 仅用于驱动衰减期间的重绘。
  const [typedAt, setTypedAt] = useState(0)
  const [, setGlowTick] = useState(0)
  const valueMounted = useRef(false)

  // value 变化（非流式时）→ 记一次按键时刻。跳过首帧挂载，避免打开就辉光。
  useEffect(() => {
    if (!valueMounted.current) { valueMounted.current = true; return }
    if (running) return
    setTypedAt(Date.now())
  }, [value])

  // 辉光衰减定时器：仅在「有未衰减完的辉光且非流式/闪光」时挂载，逐帧重绘到熄灭。
  useEffect(() => {
    if (running || flashing || !typedAt) return
    const id = setInterval(() => {
      if (Date.now() - typedAt >= GLOW_MS) { setTypedAt(0); return }
      setGlowTick(t => t + 1)
    }, GLOW_TICK)
    return () => clearInterval(id)
  }, [typedAt, running, flashing])

  // running 转变：true→false 触发闪光；false→true 重置彗星并取消残留闪光。
  useEffect(() => {
    if (running && !prevRunning.current) {
      setFlashing(false)
      setOffset(0)
    } else if (!running && prevRunning.current) {
      setFlashing(true)
      flashStartRef.current = Date.now()
      setOffset(0)
    }
    prevRunning.current = running
  }, [running])

  // 动画定时器：仅在 running 或 flashing 时挂载（空闲零定时器）。彗星头按 step 推进；
  // 闪光超过 FLASH_MS 自动收尾。step 由周长推算，使闪光约一圈、跑马灯顺滑。
  useEffect(() => {
    if (!running && !flashing) return
    const isFlash = flashing && !running
    const id = setInterval(() => {
      const P = Math.max(1, pRef.current)
      if (isFlash) {
        if (Date.now() - flashStartRef.current >= FLASH_MS) { setFlashing(false); return }
        setOffset(o => o + Math.max(1, Math.ceil(P / (FLASH_MS / FLASH_TICK))))
      } else {
        setOffset(o => o + Math.max(2, Math.round(P / 40)))
      }
    }, isFlash ? FLASH_TICK : MARQUEE_TICK)
    return () => clearInterval(id)
  }, [running, flashing])

  // ── 几何：盒宽 cols、内容高 contentH，顺时针周长 P = 2*cols + 2*contentH。──
  // 周长格编号（顺时针，从左上角起）：
  //   上边 0..cols-1（左→右）→ 右边 cols..cols+H-1（上→下）
  //   → 下边 cols+H..2cols+H-1（右→左）→ 左边 2cols+H..2cols+2H-1（下→上）
  const W = cols
  const H = Math.max(1, contentH)
  const P = 2 * W + 2 * H
  pRef.current = P

  const animated = running || flashing
  const isFlash = flashing && !running

  // 打字辉光强度（1=刚按键 .. 0=熄灭）。仅静态态（非跑马灯/闪光）才叠加。
  const sinceType = typedAt ? Date.now() - typedAt : Infinity
  const glowT = sinceType < GLOW_MS ? 1 - sinceType / GLOW_MS : 0
  const glowColor = glowT > 0 ? lerpHex(MODE_HEX[mode], GLOW_BRIGHT, Math.pow(glowT, 0.7)) : null

  // 某个周长格在当前帧的样式：未动画 → 模式色静态（或打字辉光混色）；动画中 → 落在彗星拖尾内
  // 取 ramp 亮色，否则回退模式色。闪光彗星头两格替换成 ✦/✧ 星符。
  function styleFor(perim: number, baseCh: string): Cell {
    if (!animated) {
      if (glowColor) return { ch: baseCh, color: glowColor, dim: false, bold: glowT > 0.55 }
      return { ch: baseCh, color: meta.color, dim: meta.dim, bold: false }
    }
    const d = ((offset - perim) % P + P) % P     // 落后彗星头的顺时针距离
    const ramp = isFlash ? FLASH_RAMP : MARQUEE_RAMP
    if (d < ramp.length) {
      const ch = isFlash && d < 2 ? SPARKLES[(offset >> 1) % SPARKLES.length]! : baseCh
      return { ch, color: ramp[d]!, dim: false, bold: d < 3 }
    }
    return { ch: baseCh, color: meta.color, dim: meta.dim, bold: false }
  }

  // 把同色同样式的相邻格合并成一个 <Text>，避免一行上百个 <Text> 节点。
  function runs(cells: Cell[], keyPrefix: string): React.ReactNode[] {
    const out: React.ReactNode[] = []
    let i = 0
    let k = 0
    while (i < cells.length) {
      const head = cells[i]!
      let j = i + 1
      while (
        j < cells.length &&
        cells[j]!.color === head.color &&
        cells[j]!.dim === head.dim &&
        cells[j]!.bold === head.bold
      ) j++
      const text = cells.slice(i, j).map(c => c.ch).join('')
      out.push(
        <Text key={`${keyPrefix}-${k++}`} color={head.color} dimColor={head.dim} bold={head.bold}>
          {text}
        </Text>,
      )
      i = j
    }
    return out
  }

  // 上边框中段（内宽 = W-2）：模式标签嵌中央，尾部带 shift+tab 提示（窄终端自动省略/截断）。
  const innerW = Math.max(0, W - 2)
  const hint = ' · shift+tab to cycle'
  const baseLabel = ` ${meta.label}: ${meta.tagline} `
  let label = baseLabel.length + hint.length + 4 <= innerW
    ? ` ${meta.label}: ${meta.tagline}${hint} `
    : baseLabel
  if (label.length > innerW) label = label.slice(0, innerW)   // 极窄终端兜底，避免上边溢出换行
  const dashLeft = Math.min(2, Math.max(0, innerW - label.length))
  const dashRight = Math.max(0, innerW - label.length - dashLeft)
  const midStr = '─'.repeat(dashLeft) + label + '─'.repeat(dashRight)

  // 上边各格 → 周长 0..W-1（四角用圆角 ╭╮╰╯）
  const topCells: Cell[] = [styleFor(0, '╭')]
  for (let x = 0; x < midStr.length; x++) topCells.push(styleFor(1 + x, midStr[x]!))
  topCells.push(styleFor(W - 1, '╮'))

  // 下边各格（渲染左→右，周长右→左）→ x 处周长 = W + H + (W-1-x)
  const botCells: Cell[] = []
  for (let x = 0; x < W; x++) {
    const ch = x === 0 ? '╰' : x === W - 1 ? '╯' : '─'
    botCells.push(styleFor(W + H + (W - 1 - x), ch))
  }

  // 右边各行（上→下）→ 第 r 行周长 = W + r
  const rightCells: Cell[] = []
  for (let r = 0; r < H; r++) rightCells.push(styleFor(W + r, '│'))
  // 左边各行（渲染上→下，周长下→上）→ 第 r 行周长 = 2W + H + (H-1-r)
  const leftCells: Cell[] = []
  for (let r = 0; r < H; r++) leftCells.push(styleFor(2 * W + H + (H - 1 - r), '│'))

  return (
    <Box flexDirection="column" width={W}>
      <Text>{runs(topCells, 'top')}</Text>
      <Box flexDirection="row">
        <Box flexDirection="column">
          {leftCells.map((c, r) => (
            <Text key={`l-${r}`} color={c.color} dimColor={c.dim} bold={c.bold}>{c.ch}</Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} paddingX={1} ref={contentRef}>
          {children}
        </Box>
        <Box flexDirection="column">
          {rightCells.map((c, r) => (
            <Text key={`r-${r}`} color={c.color} dimColor={c.dim} bold={c.bold}>{c.ch}</Text>
          ))}
        </Box>
      </Box>
      <Text>{runs(botCells, 'bot')}</Text>
    </Box>
  )
}

// ── history 里的一次性切换记录（scrollback 可查，设计为低调）────────────────
interface ModeSwitchBannerProps {
  mode: SessionMode
}

export function ModeSwitchBanner({ mode }: ModeSwitchBannerProps) {
  const { columns } = useWindowSize()
  // 见 ModeInputFrame：占满整行会在 Windows 触发换行 → 重绘错位 → 横幅刷屏堆叠。
  const cols = Math.max(1, (columns ?? 80) - 1)
  const meta = MODE_META[mode]

  const inner = ` switched to ${meta.label} `
  const dashes = Math.max(0, cols - inner.length)
  const left = Math.floor(dashes / 2)
  const right = dashes - left
  const line = '─'.repeat(left) + inner + '─'.repeat(right)

  return (
    <Box marginY={0}>
      <Text color={meta.color} dimColor>{line}</Text>
    </Box>
  )
}

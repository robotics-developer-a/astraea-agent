// 工具批渲染 —— 路径 A 重构（Stage 1）。
// 一个工具批 = 同一对话段里连续发生的工具调用集合，按"逐调用配对 + 同类折叠"渲染。
//   · 基础：每个 tool_use 紧跟自己的 result 作为一个视觉单元（result 按 id 回填）。
//   · 折叠：同一段里 ≥2 个同名且属于 COLLAPSE 集的调用塌缩成 "Name ×N" 一个块。
// 同一个 <ToolBatch> 既渲染 live frame 的在途批，也渲染落盘到 <Static> 的已完成批。
import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import chalk from 'chalk'
import { toolStatusColor, aggregateStatusColor, INDIGO, SILVER } from './theme'
import { subscribeSweep } from './sweepClock'

// ── 扫光（Sweep）背景效果 ───────────────────────────────────────────────────
// 运行中的工具块铺一条品牌靛蓝底带，一根星辉银「亮柱」按列横扫（扫描仪观感）。
// 纯运行态语言：工具落盘进 <Static> 后这套完全不生效，历史回归现状（零背景）。
// grill 决议详见会话；关键约束：
//   · 真 ANSI 背景色（chalk bgHex）；只在「有色终端」启用，CI/管道自动降级回现状。
//   · 带宽 = clamp(块内最长行宽, 下限 48, 上限 = 终端宽-4)，文字不截断、封顶防软折行。
//   · 亮柱位置**时间驱动**：hlStart = floor(elapsed/SWEEP_PASS_MS*band) % band → 每个工具自其开始
//     时刻起、固定 SWEEP_PASS_MS 扫满一趟（与带宽无关），起始帧在最左。共享节拍只催重绘、不定速度。
//     同块内多行用同一 elapsed → 竖亮柱按列对齐；跨工具各自从头、各自计时。

const SWEEP_BG = INDIGO     // 底色：品牌靛蓝 #6A5ACD
const SWEEP_HL = SILVER     // 亮柱：星辉银 #C8D8FF
const SWEEP_MIN_BAND = 48   // 带宽下限
const SWEEP_HL_WIDTH = 4    // 亮柱宽（列）
const SWEEP_PASS_MS = 300   // 亮柱扫满整条带一趟的时长（与带宽无关）→ 越小越快
// 收尾保活：工具结束后扫光至少再播这么久才冻结落盘。否则瞬时工具（Read/Edit/Grep… <120ms 就 done）
// 还没扫完就被冻结 → 看着「没动画、不连贯」。720ms 内（按 SWEEP_PASS_MS=300）能完整扫 ~2 趟，
// 每个工具都有一段连贯可见的扫光后再定格。
const SWEEP_GRACE_MS = 720

// 终端是否支持背景色：无色（CI / 管道 / 哑终端）→ 降级回现状渲染，不扫光。
const SWEEP_OK = chalk.level > 0

function termWidth(): number {
  return process.stdout.columns || 80
}

// 把一行纯文本铺成「靛蓝底 + 银亮柱」的 ANSI 串：定宽 bandWidth，亮柱起于 hlStart（环绕）。
function paintSweepLine(plain: string, bandWidth: number, hlStart: number): string {
  const chars = Array.from(plain)  // 按码点切，让亮柱按列对齐
  let out = ''
  for (let col = 0; col < bandWidth; col++) {
    const ch = chars[col] ?? ' '
    const rel = (col - hlStart + bandWidth) % bandWidth  // 环绕：亮柱跨末尾时无缝接回行首
    if (rel < SWEEP_HL_WIDTH) out += chalk.bgHex(SWEEP_HL).hex(SWEEP_BG)(ch)  // 亮柱：银底靛字
    else out += chalk.bgHex(SWEEP_BG).hex(SWEEP_HL)(ch)                       // 底带：靛底银字
  }
  return out
}

// 扫光生命周期：决定「这一行此刻是否该扫光」并给出当前相位。
//   · running → 扫。
//   · 刚结束（done/error）但「曾经历过 running」→ 收尾保活，再扫满 SWEEP_GRACE_MS 才停。
//   · 直接以 done 挂载（<Static> 历史行，从没经历 running）→ 永不扫，回归现状。
// 用「是否曾见过 running」(startRef) 自动区分 live 在途行与历史落盘行，无需外部传 isLive。
// 订阅共享时钟仅在 animate 为真时进行；最后一条停扫即退订 → 全局时钟自动停。
function useSweepLifecycle(running: boolean): { animate: boolean; elapsed: number } {
  const startRef = useRef<number | null>(null)
  if (running && startRef.current === null) startRef.current = Date.now()
  const sawRunning = startRef.current !== null

  const [, tick] = useState(0)         // 仅作「催重绘」用，位置全由 elapsed 时间算
  const [, forceFreeze] = useState(0)  // 宽限期满后强制一次重渲染翻到冻结态

  const elapsed = startRef.current === null ? 0 : Date.now() - startRef.current
  const inGrace = !running && elapsed < SWEEP_GRACE_MS
  const animate = SWEEP_OK && sawRunning && (running || inGrace)

  // 仅在 animate 期间订阅节拍催重绘；animate 转 false 时 cleanup 退订。
  useEffect(() => {
    if (!animate) return
    return subscribeSweep(() => tick(n => n + 1))
  }, [animate])

  // 工具刚结束时安排一次「宽限期满」的兜底重渲染：即便此时它是最后一条、共享时钟随即停，
  // 也保证有一帧把扫光翻成冻结态（不会卡在最后一帧扫光上）。
  useEffect(() => {
    if (running || startRef.current === null) return
    const remaining = SWEEP_GRACE_MS - (Date.now() - startRef.current)
    if (remaining <= 0) return
    const t = setTimeout(() => forceFreeze(n => n + 1), remaining + 20)
    return () => clearTimeout(t)
  }, [running])

  return { animate, elapsed }
}

// 扫光块：把一组纯文本行整体铺成同相的靛蓝底带，一根银亮柱按列横扫所有行（elapsed 由父级传入）。
function SweepBlock({ lines, elapsed }: { lines: string[]; elapsed: number }) {
  const cap = Math.max(8, termWidth() - 4)
  const maxLen = lines.reduce((m, l) => Math.max(m, Array.from(l).length), 0)
  const band = Math.min(Math.max(maxLen, SWEEP_MIN_BAND), cap)
  // 时间驱动：每 SWEEP_PASS_MS 扫满一趟（与 band 无关）；elapsed=0 → hlStart=0（最左、从头扫起）。
  const hlStart = Math.floor((elapsed / SWEEP_PASS_MS) * band) % band
  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        // truncate-end 是擦除安全网：band 已 ≤ 终端宽-4，正常不会软折行成多物理行。
        <Text key={i} wrap="truncate-end">{paintSweepLine(l, band, hlStart)}</Text>
      ))}
    </Box>
  )
}

// LiveOut 尾巴转纯文本行（与 <LiveOut> 同口径：trimEnd → 末 20 行 → 4 空格 + "⎿  " 悬挂缩进）。
function liveOutPlainLines(text: string): string[] {
  return text.trimEnd().split('\n').slice(-20).map(line => '    ⎿  ' + line)
}

// 一次工具调用（在途或已完成）。result 在 tool_result 事件按 id 回填。
export interface ToolCall {
  toolUseId: string
  name: string
  argText: string
  status: 'running' | 'done' | 'error'
  resultLines?: string[]  // 离开 'running' 时写入
}

// 启用"同类折叠"的工具（grill 决议：Glob/Read/Grep/Bash）。其余工具一律逐调用配对。
const COLLAPSE = new Set(['Glob', 'Read', 'Grep', 'Bash'])

interface Group {
  name: string
  collapsed: boolean
  calls: ToolCall[]
}

// 把调用序列切成"连续同名"的组；满足 折叠集 且 ≥2 个 → collapsed。
export function groupCalls(calls: ToolCall[]): Group[] {
  const groups: Group[] = []
  for (const c of calls) {
    const last = groups[groups.length - 1]
    if (last && last.name === c.name) last.calls.push(c)
    else groups.push({ name: c.name, collapsed: false, calls: [c] })
  }
  for (const g of groups) g.collapsed = g.calls.length >= 2 && COLLAPSE.has(g.name)
  return groups
}

// 结果多行块：第一行 ⎿，后续行按 +/- 上色（对齐原 tool_result 渲染）。
function ResultLines({ lines }: { lines: string[] }) {
  // 拍平内嵌换行：像 Glob 这类无 renderResult 的工具，整段结果是「一个含 \n 的字符串」，
  // 若不拆开，那些续行会落回 marginLeft 基线（第 4 列）而不是对齐到 ⎿ 内容（第 7 列），
  // 形成参差。拆成「每物理行一个元素」后，首行画 ⎿、续行统一 3 空格悬挂缩进 → 内容齐第 7 列。
  const flat = lines.flatMap(l => l.split('\n'))
  return (
    <Box flexDirection="column" marginLeft={4} marginBottom={1}>
      {flat.map((line, i) => {
        const prefix = i === 0 ? '⎿  ' : '   '
        // 工具自带 ANSI 样式（如 Edit/Write 的 diff 背景带）→ 原样输出，不再二次上色，
        // 让内嵌的 bg/fg 完全生效（与 markdown 渲染同模式：纯 <Text> 透传 ANSI）。
        if (line.includes('\x1b[')) {
          return <Text key={i} wrap="truncate-end">{prefix}{line}</Text>
        }
        const t = line.trimStart()
        const isAdded = t.startsWith('+')
        const isRemoved = t.startsWith('-')
        const color = isAdded ? 'green' : isRemoved ? 'red' : 'gray'
        return (
          <Text key={i} color={color} dimColor={!isAdded && !isRemoved} wrap="truncate-end">
            {prefix}{line}
          </Text>
        )
      })}
    </Box>
  )
}

// 在途工具的实时输出尾巴（tool_progress 累积，仅取末 20 行）。
function LiveOut({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginLeft={4}>
      {text.trimEnd().split('\n').slice(-20).map((line, i) => (
        // 关键：必须 truncate-end，与 ResultLines/CollapsedGroup 一致。否则长行（如
        // PowerShell 带长路径的实时 stdout）会软折行成多物理行，Ink 按逻辑行数擦除时
        // 少算行数 → 上一帧擦不干净 → 输入框被顶出视口并留下一份残影（Windows 实测：
        // 输入框上下各出现一个）。截断成单物理行后，逻辑行数==物理行数，擦除才数得准。
        <Text key={i} color="gray" dimColor wrap="truncate-end">⎿  {line}</Text>
      ))}
    </Box>
  )
}

// 非折叠：经典两段式——⏺ 调用行 + 其 result 块。running 时缀 " …"。
function ToolCallRow({ call, liveOutput }: { call: ToolCall; liveOutput?: string }) {
  const running = call.status === 'running'
  // 运行中 + 收尾保活窗口内 → ⏺ 头行单独扫光（聚焦工具名一行），实时输出独立渲染。
  // 收尾期里头行保持与运行时一致（含 " …"），让「运行→定格」无缝衔接，再 snap 成 done 行。
  const { animate, elapsed } = useSweepLifecycle(running)
  if (animate) {
    const head = `⏺ ${call.name}(${call.argText}) …`
    return (
      <Box flexDirection="column">
        <SweepBlock lines={[head]} elapsed={elapsed} />
        {liveOutput ? <LiveOut text={liveOutput} /> : null}
      </Box>
    )
  }
  // 克制上色：marker ⏺ 与工具名按状态色上色（作状态锚点），仅括号内参数留白
  // （running 黄（进行中）· done 绿（已落盘）· error 红（失败））。
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={toolStatusColor(call.status)}>{'⏺ '}{call.name}</Text>
        {`(${call.argText})${running ? ' …' : ''}`}
      </Text>
      {!running && call.resultLines ? <ResultLines lines={call.resultLines} /> : null}
      {running && liveOutput ? <LiveOut text={liveOutput} /> : null}
    </Box>
  )
}

// 折叠：⏺ Name ×N 标题 + 每调用一行 "⎿ arg → 结果摘要"。
function CollapsedGroup({ group, liveOutput }: { group: Group; liveOutput?: string }) {
  const doneN = group.calls.filter(c => c.status !== 'running').length
  const total = group.calls.length
  const progress = doneN < total ? ` (${doneN}/${total})` : ''
  const anyRunning = doneN < total
  // 折叠组的聚合色：任一失败 → 红，否则任一在跑 → 黄，全部完成 → 绿。
  const headColor = aggregateStatusColor(group.calls.map(c => c.status))
  // 组内有调用在跑 + 收尾保活窗口内 → ⏺ 头行单独扫光，子调用行和实时输出独立渲染。
  const { animate, elapsed } = useSweepLifecycle(anyRunning)
  if (animate) {
    const head = `⏺ ${group.name} ×${total}${progress}`
    const childLines = group.calls.map(c => {
      const summary = c.status === 'running' ? '…' : (c.resultLines?.[0] ?? '')
      return `    ⎿ ${c.argText} → ${summary}`
    })
    return (
      <Box flexDirection="column">
        <SweepBlock lines={[head]} elapsed={elapsed} />
        <Box flexDirection="column" marginLeft={4}>
          {childLines.map((line, i) => (
            <Text key={i} color="gray" dimColor wrap="truncate-end">{line}</Text>
          ))}
        </Box>
        {liveOutput ? <LiveOut text={liveOutput} /> : null}
      </Box>
    )
  }
  // 克制上色：marker ⏺ 与工具名按聚合状态色上色，仅 "×N (n/m)" 计数留白。
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text wrap="truncate-end">
        <Text color={headColor}>{'⏺ '}{group.name}</Text>
        {` ×${total}${progress}`}
      </Text>
      {/* ⎿ 统一缩进到第 4 列，与非折叠的 ResultLines 对齐（trace 1：折叠 2 格/普通 4 格不一致）。 */}
      <Box flexDirection="column" marginLeft={4}>
        {group.calls.map(c => {
          const summary = c.status === 'running' ? '…' : (c.resultLines?.[0] ?? '')
          return (
            <Text key={c.toolUseId} color="gray" dimColor wrap="truncate-end">
              ⎿ {c.argText} → {summary}
            </Text>
          )
        })}
      </Box>
      {anyRunning && liveOutput ? <LiveOut text={liveOutput} /> : null}
    </Box>
  )
}

// 工具批：分组后，折叠组走 CollapsedGroup，其余逐调用走 ToolCallRow。
export function ToolBatch({ calls, liveOutput }: { calls: ToolCall[]; liveOutput?: string }) {
  if (calls.length === 0) return null
  const groups = groupCalls(calls)
  return (
    <Box flexDirection="column">
      {groups.map((g, gi) =>
        g.collapsed ? (
          <CollapsedGroup key={gi} group={g} liveOutput={liveOutput} />
        ) : (
          <React.Fragment key={gi}>
            {g.calls.map(c => (
              <ToolCallRow key={c.toolUseId} call={c} liveOutput={liveOutput} />
            ))}
          </React.Fragment>
        ),
      )}
    </Box>
  )
}

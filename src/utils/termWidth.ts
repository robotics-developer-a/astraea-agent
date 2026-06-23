// 终端显示宽度工具。
//
// 用途：把"进行中"的流式预览按列数硬截断，保证每行都不超出终端宽度。
// 为什么需要：Ink 重绘时按"换行符行数"来擦除上一帧，但一旦某行的显示宽度超过终端列数，
// 终端会自动折行成多条物理行，Ink 擦除就少算了行数——上一帧擦不干净，于是 ✦ Astraea
// 头部和正文一层层重影堆叠（Windows 终端尤其明显，且中文全角字符宽度=2 必然触发）。
// 把每行截到列宽以内后，逻辑行数 == 物理行数，擦除才数得准。

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g
const ANSI_RESET = '\x1B[0m'

function stripTerminalControls(s: string): string {
  return s.replace(ANSI_RE, '')
}

// 字符显示宽度：CJK / 全角 = 2，其余 = 1。
export function charDisplayWidth(cp: number): 1 | 2 {
  return cp >= 0x1100 && (
    cp <= 0x115F || cp === 0x2329 || cp === 0x232A ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1F300 && cp <= 0x1FAFF) ||
    (cp >= 0x20000 && cp <= 0x3FFFD)
  ) ? 2 : 1
}

// 一段纯文本的显示宽度（按列计）。
export function stringDisplayWidth(s: string): number {
  let w = 0
  for (const ch of stripTerminalControls(s)) w += charDisplayWidth(ch.codePointAt(0) ?? 0)
  return w
}

function clampTerminalLineWidth(line: string, maxWidth: number, preserveAnsi: boolean): string {
  const budget = maxWidth - 1 // 最终宽度上限（严格小于 maxWidth）
  if (budget <= 0) return ''
  if (stringDisplayWidth(line) <= budget) return line

  let width = 0
  let out = ''
  let i = 0
  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1B) {
      ANSI_RE.lastIndex = i
      const m = ANSI_RE.exec(line)
      if (m && m.index === i) {
        if (preserveAnsi) out += m[0]
        i += m[0].length
        continue
      }
    }

    const cp = line.codePointAt(i) ?? 0
    const ch = String.fromCodePoint(cp)
    const w = charDisplayWidth(cp)
    if (width + w > budget - 1) break
    out += ch
    width += w
    i += ch.length
  }

  // INTENT: If markdown styling was open at the truncation point, reset before
  // the ellipsis so the rest of the live frame cannot inherit a half-cut ANSI span.
  return preserveAnsi ? out + ANSI_RESET + '…' : out + '…'
}

// 把一行纯文本按"显示宽度"截断；返回值的显示宽度严格 < maxWidth，确保终端不会折行。
// 超出时用 … 收尾，且为省略号预留 1 列，保证含省略号后仍不超宽。
export function clampLineWidth(line: string, maxWidth: number): string {
  return clampTerminalLineWidth(line, maxWidth, false)
}

// 与 clampLineWidth 相同，但保留 markdown renderer 产生的 ANSI 样式控制符。
export function clampAnsiLineWidth(line: string, maxWidth: number): string {
  return clampTerminalLineWidth(line, maxWidth, true)
}

// 把多行文本处理成"只保留尾部 maxLines 行、且每行都不超宽"的纯文本预览。
export function safeWinPreview(text: string, cols: number, maxLines: number): string {
  const lines = text.split('\n')
  const tail = lines.length <= maxLines ? lines : ['⋯', ...lines.slice(-maxLines)]
  return tail.map((l) => clampLineWidth(l, cols)).join('\n')
}

// markdown 渲染后的 live 预览：保留 ANSI 样式，但仍保证每一行严格小于终端列宽。
export function safeAnsiPreview(text: string, cols: number, maxLines: number): string {
  const lines = text.split('\n')
  const tail = lines.length <= maxLines ? lines : ['⋯', ...lines.slice(-maxLines)]
  return tail.map((l) => clampAnsiLineWidth(l, cols)).join('\n')
}

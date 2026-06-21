// 把「拖进终端的文件」识别出来，还原成干净的绝对路径。
//
// 为什么需要它：当你把一个文件从访达 / 资源管理器拖进终端窗口时，终端并不会发一个
// 「drop 事件」给程序——它只是把这个文件的路径当作一段「粘贴」塞进来（走 bracketed-
// paste，和 Ctrl+V 同一条通道）。但不同平台塞进来的写法各不相同，原样插进输入框很难看，
// 也不利于后续当成路径使用：
//
//   - macOS Terminal.app / iTerm2：POSIX 绝对路径，空格和括号等特殊字符被反斜杠转义，
//       例如  /Users/me/My\ Photos/a\ (1).png ，且常在末尾多补一个空格。
//   - Linux 各终端：同上，shell 风格反斜杠转义。
//   - Windows Terminal / conhost：Windows 绝对路径，含空格时整体被双引号包起来，
//       例如  "C:\Users\me\My Photos\a.png" ；不含空格则裸路径。
//
// 处理策略（对齐 Claude Code 的 imagePaste 思路，但泛化到任意文件、并用「文件确实存在」
// 作为强信号，避免把普通文本误当成路径）：
//   1. 去掉首尾包裹的成对引号；
//   2. 在 macOS/Linux 上去掉 shell 转义反斜杠（Windows 的 \ 是路径分隔符，保留）；
//   3. 去掉终端补的首尾空白；
//   4. 必须长得像「绝对路径」且在磁盘上真实存在，才认定是拖进来的文件。
//
// 任一条件不满足都返回 null，调用方据此回退到普通粘贴逻辑——绝不影响正常输入。

import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

/** 去掉首尾成对的单引号或双引号（Windows 拖入含空格路径会被双引号包裹）。 */
function removeOuterQuotes(text: string): string {
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * 去掉 shell 转义反斜杠（仅 macOS/Linux）。Windows 上 `\` 是路径分隔符，原样返回。
 * 形如 "My\ Photos\ \(1\).png" → "My Photos (1).png"。
 */
function stripBackslashEscapes(path: string): string {
  if (process.platform === 'win32') return path

  // 先把「双反斜杠」（代表文件名里真实存在的一个反斜杠）换成随机占位符，避免被下一步
  // 当成转义吃掉；随机 salt 防止路径里恰好含有占位符字面量造成的注入。
  const salt = randomBytes(8).toString('hex')
  const placeholder = `__DBLBS_${salt}__`
  const withPlaceholder = path.replace(/\\\\/g, placeholder)
  // 去掉单个转义反斜杠："\ " → " "，"\(" → "(" 等。
  const withoutEscapes = withPlaceholder.replace(/\\(.)/g, '$1')
  return withoutEscapes.replace(new RegExp(placeholder, 'g'), '\\')
}

/** 看起来是否像一个绝对路径（POSIX `/`、`~/`，或 Windows 盘符 / UNC）。 */
function looksAbsolute(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(path) || // C:\ 或 C:/
    path.startsWith('\\\\') // UNC \\server\share
  )
}

/** 把单个候选 token 还原成干净路径；不像路径或不存在则返回 null。 */
function cleanOne(token: string): string | null {
  const cleaned = stripBackslashEscapes(removeOuterQuotes(token.trim())).trim()
  if (!cleaned || cleaned.includes('\n')) return null
  if (!looksAbsolute(cleaned)) return null
  if (!existsSync(cleaned)) return null
  return cleaned
}

/**
 * 把一段粘贴文本识别为「拖进来的文件路径」。识别成功返回还原后的绝对路径（多文件用空格
 * 连接，含空格的路径用单引号包裹以便区分）；不是拖入路径则返回 null。
 */
export function normalizeDraggedPath(text: string): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes('\n')) return null

  // 先按「整段就是一个路径」尝试——最常见，也最稳（路径里可能含未转义空格的极端情况）。
  const single = cleanOne(trimmed)
  if (single) return quoteIfNeeded(single)

  // 再尝试「一次拖入多个文件」：macOS 用未转义空格分隔、各自内部空格被反斜杠转义。
  // 按「未被反斜杠转义的空格」切分，逐个还原；要求每一段都真实存在才算数。
  const parts = splitUnescapedSpaces(trimmed)
  if (parts.length < 2) return null
  const resolved: string[] = []
  for (const part of parts) {
    const one = cleanOne(part)
    if (!one) return null // 只要有一段不是真实文件，就不当作拖入，整体回退普通粘贴
    resolved.push(quoteIfNeeded(one))
  }
  return resolved.join(' ')
}

/** 含空格的路径包一层单引号，方便在一行里和其他内容 / 多个路径区分。 */
function quoteIfNeeded(path: string): string {
  return path.includes(' ') ? `'${path}'` : path
}

/** 按「没有被反斜杠转义的空格」切分（macOS 多文件拖入的分隔符）。 */
function splitUnescapedSpaces(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) {
      cur += ch + text[i + 1]
      i++
      continue
    }
    if (ch === ' ') {
      if (cur) out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

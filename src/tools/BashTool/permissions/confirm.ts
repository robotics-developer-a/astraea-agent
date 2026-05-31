// 终端确认对话框 — 在 Ink raw mode 环境下安全弹出
//
// Ink 的 render() 会启用 raw mode（逐字符读取）。
// 确认对话框需要行模式（readline），因此：
//   1. 临时禁用 raw mode
//   2. 用 readline 读一行用户输入
//   3. 还原 raw mode
//
// 这在 isStreaming=true 时是安全的，因为 TextInput focus={false}，
// Ink 不会并发消费 stdin。

import { createInterface } from 'readline'

export interface ConfirmResult {
  proceed: boolean
  /** 用户选了"永远允许/拒绝"时非 null，调用方负责持久化 */
  remember: 'always-allow' | 'always-deny' | null
}

const RESET  = '\x1b[0m'
const YELLOW = '\x1b[33m'
const GRAY   = '\x1b[90m'
const BOLD   = '\x1b[1m'

export async function confirmWithUser(
  command: string,
  description?: string,
): Promise<ConfirmResult> {
  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean }
  const isTTY  = stdin.isTTY ?? false
  const wasRaw = isTTY && (stdin.isRaw === true)

  // 释放 raw mode，让 readline 能读整行
  if (isTTY && wasRaw) stdin.setRawMode(false)

  try {
    return await readConfirmation(command, description)
  } finally {
    // 无论成功/失败都还原，防止终端状态残留
    if (isTTY && wasRaw) stdin.setRawMode(true)
  }
}

function readConfirmation(command: string, description?: string): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })

    const descLine = description ? `\n│  ${GRAY}${description}${RESET}` : ''
    process.stdout.write(
      `\n${BOLD}┌─ Astraea wants to run:${RESET}\n` +
      `│  ${YELLOW}${command}${RESET}${descLine}\n` +
      `│\n` +
      `│  ${BOLD}[y]${RESET} Yes   ${BOLD}[n]${RESET} No   ` +
      `${BOLD}[a]${RESET} Always allow   ${BOLD}[d]${RESET} Always deny\n` +
      `└─ > `,
    )

    rl.once('line', (answer) => {
      rl.close()
      resolve(parseAnswer(answer.trim().toLowerCase()))
    })

    // Ctrl+C 中途 → 视为拒绝
    rl.once('close', () => {
      resolve({ proceed: false, remember: null })
    })
  })
}

function parseAnswer(key: string): ConfirmResult {
  switch (key) {
    case 'y':
    case 'yes':
      return { proceed: true, remember: null }
    case 'a':
      return { proceed: true, remember: 'always-allow' }
    case 'd':
      return { proceed: false, remember: 'always-deny' }
    default: // n, no, 回车, 其他
      return { proceed: false, remember: null }
  }
}

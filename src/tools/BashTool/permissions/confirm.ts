// 终端确认对话框
//
// 首选：Ink 方向键选择器（通过 confirmBridge → App.tsx 的 ConfirmSelector）。
//       用户只需 ↑↓ 移动 + Enter 确认，体验与 /mode 选择器一致，无需输入 y/n。
// 回退：当没有 Ink UI 订阅者时（纯 CLI / 测试），退回 readline 行输入。
//       readline 需要行模式，因此临时禁用 raw mode、读一行、再还原。

import { createInterface } from 'readline'
import {
  hasConfirmUI,
  requestConfirm,
  type ConfirmResult,
} from './confirmBridge.js'

export type { ConfirmResult }

export async function confirmWithUser(
  command: string,
  description?: string,
  kind: 'bash' | 'file' | 'action' = 'bash',
): Promise<ConfirmResult> {
  // 首选方向键选择器（有 Ink UI 时）
  if (hasConfirmUI()) {
    return requestConfirm({ command, description, kind })
  }
  // 回退：readline 行输入（无 UI 场景）
  return readlineConfirm(command, description, kind)
}

const RESET  = '\x1b[0m'
const YELLOW = '\x1b[33m'
const GRAY   = '\x1b[90m'
const BOLD   = '\x1b[1m'

async function readlineConfirm(
  command: string,
  description?: string,
  kind: 'bash' | 'file' | 'action' = 'bash',
): Promise<ConfirmResult> {
  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean }
  const isTTY  = stdin.isTTY ?? false
  const wasRaw = isTTY && (stdin.isRaw === true)

  // 释放 raw mode，让 readline 能读整行
  if (isTTY && wasRaw) stdin.setRawMode(false)

  try {
    return await readConfirmation(command, description, kind)
  } finally {
    // 无论成功/失败都还原，防止终端状态残留
    if (isTTY && wasRaw) stdin.setRawMode(true)
  }
}

function readConfirmation(command: string, description?: string, kind: 'bash' | 'file' | 'action' = 'bash'): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })

    const descLine = description ? `\n│  ${GRAY}${description}${RESET}` : ''
    // 文件写：Yes / 本会话全允许（切 cruise）/ No；Bash：Yes / No / Always allow / Always deny
    const optionLine = kind === 'file'
      ? `│  ${BOLD}[y]${RESET} Yes   ${BOLD}[s]${RESET} Yes, all edits this session → cruise   ${BOLD}[n]${RESET} No\n`
      : kind === 'action'
        ? `│  ${BOLD}[y]${RESET} Yes   ${BOLD}[n]${RESET} No\n`
      : `│  ${BOLD}[y]${RESET} Yes   ${BOLD}[n]${RESET} No   ${BOLD}[a]${RESET} Always allow   ${BOLD}[d]${RESET} Always deny\n`
    process.stdout.write(
      `\n${BOLD}┌─ Astraea wants to run:${RESET}\n` +
      `│  ${YELLOW}${command}${RESET}${descLine}\n` +
      `│\n` +
      optionLine +
      `└─ > `,
    )

    rl.once('line', (answer) => {
      rl.close()
      resolve(parseAnswer(answer.trim().toLowerCase(), kind))
    })

    // Ctrl+C 中途 → 视为拒绝
    rl.once('close', () => {
      resolve({ proceed: false, remember: null })
    })
  })
}

function parseAnswer(key: string, kind: 'bash' | 'file' | 'action' = 'bash'): ConfirmResult {
  if (kind === 'file') {
    switch (key) {
      case 'y':
      case 'yes':
        return { proceed: true, remember: null }
      case 's':
        return { proceed: true, remember: 'session-cruise' }
      default: // n, no, 回车, 其他
        return { proceed: false, remember: null }
    }
  }
  if (kind === 'action') {
    return { proceed: key === 'y' || key === 'yes', remember: null }
  }
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

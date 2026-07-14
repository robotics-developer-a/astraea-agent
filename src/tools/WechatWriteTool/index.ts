import { join } from 'node:path'
import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { checkWechatSetup } from '../../utils/wechatSetupGuard.js'

const SCRIPT = join(import.meta.dir, 'send_message.py')

// 键盘模拟发送(Cmd+F 搜索 → 粘贴 → 回车)正常几秒完成;微信弹窗/焦点丢失时
// python 可能卡住,此前会无限 await。30s 墙钟 + 调用方 AbortSignal 双保险。
const SEND_TIMEOUT_MS = 30_000

async function runSend(args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (signal?.aborted) return { error: 'aborted' }
  const proc = Bun.spawn(['python3', SCRIPT], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try { proc.kill('SIGKILL') } catch { /* already dead */ }
  }, SEND_TIMEOUT_MS)
  const onAbort = () => { try { proc.kill('SIGKILL') } catch { /* already dead */ } }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    proc.stdin.write(new TextEncoder().encode(JSON.stringify(args)))
    proc.stdin.end()
    const [stdout, , exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (timedOut) {
      return { error: `WeChat send timed out after ${SEND_TIMEOUT_MS / 1000}s — the message may NOT have been sent. Check WeChat is open and focused before retrying.` }
    }
    if (signal?.aborted) return { error: 'aborted — the message may NOT have been sent.' }
    try {
      return JSON.parse(stdout.trim())
    } catch {
      return { error: `python3 exited ${exit}: ${stdout.slice(0, 200)}` }
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
export const WechatWriteTool = buildTool({
  name: 'WechatWrite',
  description: `Send a WeChat message to a contact or group chat via macOS keyboard simulation.
Does not require Accessibility API — navigates via Cmd+F search, pastes via clipboard.

Contact names MUST be the exact strings as they appear in WeChat, in the original language.
Do NOT transliterate Chinese names to English (use "李嘉俊", never "Li Jiajun").

Requires: WeChat open on screen (macOS only). Same setup as WechatRead.`,
  isReadOnly: () => false,
  // 发出的消息无法撤回给未读方 —— 标记不可逆,调度层/UI 据此提示
  isDestructive: () => true,
  inputSchema: {
    type: 'object',
    properties: {
      contact: {
        type: 'string',
        description: 'Exact contact or group chat name as shown in WeChat.',
      },
      message: {
        type: 'string',
        description: 'Text message to send. Sent as plain text; do not include Markdown formatting.',
      },
    },
    required: ['contact', 'message'],
  },

  async call(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolCallResult> {
    const setupError = checkWechatSetup()
    if (setupError) return { output: setupError, isError: true }

    const contact = String(input['contact'] ?? '').trim()
    const message = String(input['message'] ?? '').trim()

    if (!contact) return { output: 'contact is required.', isError: true }
    if (!message) return { output: 'message is required.', isError: true }

    const result = await runSend({ contact, message }, ctx.abortSignal)

    if (result['error']) {
      return { output: String(result['error']), isError: true }
    }

    return {
      output: `已向「${contact}」发送消息（${result['message_length']} 字）。`,
    }
  },
})

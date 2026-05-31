import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { checkWechatSetup } from '../../utils/wechatSetupGuard.js'
import type { WechatSettings, WechatOrganizeMode } from '../../settings.js'

const SCRIPT     = join(import.meta.dir, 'screenshot_ocr.py')
const ABORT_FILE = '/tmp/.wechat_read_abort'

// 所有正在运行的 python 子进程。abortWechatRead() 会直接 kill 它们——
// 仅靠 abort 文件不够：文件只在滚动循环边界被检查，且子进程可能孤儿化。
const running = new Set<import('bun').Subprocess>()

/** 立即停止所有进行中的微信读取：写 abort 文件 + 直接杀掉子进程。 */
export function abortWechatRead() {
  try { writeFileSync(ABORT_FILE, '') } catch { /* best effort */ }
  for (const p of running) { try { p.kill('SIGKILL') } catch { /* already dead */ } }
  running.clear()
}

// 兜底：Astraea 进程因任何原因退出时，杀掉所有子进程，杜绝孤儿进程继续操作鼠标键盘。
const _killChildren = () => { for (const p of running) { try { p.kill('SIGKILL') } catch { /* dead */ } } }
process.on('exit', _killChildren)
process.on('SIGINT', _killChildren)
process.on('SIGTERM', _killChildren)

async function runOcr(args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (signal?.aborted) return { error: 'aborted' }
  const proc = Bun.spawn(['python3', SCRIPT], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  running.add(proc)
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
    try {
      return JSON.parse(stdout.trim())
    } catch {
      return { error: `python3 exited ${exit}: ${stdout.slice(0, 200)}` }
    }
  } finally {
    running.delete(proc)
    signal?.removeEventListener('abort', onAbort)
  }
}

// ── Summarization prompt builder ──────────────────────────────────────────────

function buildSummarizationPrompt(
  rawText: string,
  contactNames: string[],
  settings: WechatSettings,
): string {
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

  const organizeInstructions = buildOrganizeSections(settings.organize, contactNames)

  return `你是用户的个人信息助理。以下是用户最近 ${settings.days} 天的微信聊天记录（通过截图 OCR 识别）。

## 背景说明
- 今天是：${today}
- 涉及联系人：${contactNames.join('、')}
- "我" 代表用户本人
- 文字可能有 OCR 识别误差，请合理推断含义
- 忽略语音消息标注（[语音]）、图片标注（[图片]）、表情标注

---

## 原始聊天记录

${rawText}

---

## 整理任务

严格遵守以下规则：
- ✅ 保留：时间安排、具体事项、决定、请求、重要信息、未来计划、承诺
- ❌ 忽略：单独的"好的"/"嗯"/"哦"/"谢谢"等无实质内容的回复；纯寒暄问候；重复信息（多次提及只记一次）

### 一、重要内容提取

提取所有有实质意义的内容，格式：
> **[联系人]** [时间]：[一句话摘要]

### 二、待办事项（需要用户行动的）

提取所有需要用户（"我"）未来执行的事项，包括：被他人请求、自己承诺、未完成的安排。

格式：
- [ ] [具体事项] —— **[提出人]** 于 [时间] 提出

### 三、待回复 / 待跟进

对方问了问题但用户未回、对方提了请求但用户未明确答复，列出这些需要跟进的内容。

${organizeInstructions}

---

请输出一份清晰的 Markdown 文档，包含以上所有章节，内容要简洁有力，不要冗余。`
}

function buildOrganizeSections(modes: WechatOrganizeMode[], contacts: string[]): string {
  const sections: string[] = []

  if (modes.includes('timeline')) {
    sections.push(`### 四、时间线

按日期从新到旧排列所有重要内容（每天一个小节，只包含有实质内容的日期）。`)
  }

  if (modes.includes('contacts')) {
    const contactList = contacts.map(c => `- **${c}**`).join('\n')
    sections.push(`### ${sections.length + 4}、按联系人分类

对每位联系人的沟通做独立小结：
${contactList}`)
  }

  if (modes.includes('topics')) {
    sections.push(`### ${sections.length + 4}、按主题分类

自动识别讨论主题（如：工作安排、项目讨论、家庭事务、财务、健康……），将相关内容归入对应主题。每个主题至少有 2 条有意义的内容才列出。`)
  }

  if (modes.includes('decisions')) {
    sections.push(`### ${sections.length + 4}、决策记录

提取所有明确的决定（谁决定了什么、何时决定），格式：
- [决定内容] —— 由 **[决策人]** 于 [时间] 确定`)
  }

  if (modes.includes('promises')) {
    sections.push(`### ${sections.length + 4}、承诺追踪

提取聊天中出现的所有承诺（谁承诺了什么），格式：
- [承诺内容] —— **[承诺人]** 于 [时间] 承诺，状态：[已兑现 / 待兑现 / 未知]`)
  }

  return sections.join('\n\n')
}

// ── Contact resolution ────────────────────────────────────────────────────────

async function resolveContacts(settings: WechatSettings, signal?: AbortSignal): Promise<string[] | { error: string }> {
  const { scope } = settings
  if (scope.type === 'contacts') return scope.names

  // For 'all' and 'top', discover from WeChat sidebar
  const limit = scope.type === 'top' ? scope.k : Math.min(scope.limit, 50)
  const result = await runOcr({ action: 'list_contacts', limit }, signal)
  if (result['error']) return { error: String(result['error']) }
  const contacts = result['contacts'] as string[] | undefined
  if (!contacts?.length) return { error: 'Could not detect contacts from WeChat sidebar.' }
  return scope.type === 'top' ? contacts.slice(0, scope.k) : contacts
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const WechatReadTool: Tool = {
  name: 'WechatRead',
  description: `Read WeChat chat messages via screenshot + macOS Vision OCR.
Does not require Accessibility API — works with any WeChat version.

Contact names MUST be the exact strings as they appear in WeChat,
in the original language. Do NOT transliterate Chinese names to English
(use "李嘉俊", never "Li Jiajun").

Use contacts[] for multiple people. When wechat settings are provided,
call with { use_settings: true } to read from configured scope and generate
a structured summary.

Requires: WeChat open and visible on screen.`,
  isReadOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      contact: {
        type: 'string',
        description: 'Single contact or group chat name.',
      },
      contacts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple contacts to read sequentially.',
      },
      target_date: {
        type: 'string',
        description: 'Scroll back to this date (YYYY-MM-DD). Defaults to settings.days ago.',
      },
      max_scrolls: {
        type: 'number',
        description: 'Max upward scrolls per contact (default 30).',
      },
      use_settings: {
        type: 'boolean',
        description: 'If true, read scope + days from wechat settings and return summarization prompt.',
      },
      wechat_settings: {
        type: 'object',
        description: 'Serialized WechatSettings (injected by /wechat command).',
      },
    },
  },

  async call(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> {
    const setupError = checkWechatSetup()
    if (setupError) return { output: setupError, isError: true }

    const settingsRaw = input['wechat_settings'] as WechatSettings | undefined
    const useSettings = Boolean(input['use_settings']) || Boolean(settingsRaw)

    // ── Settings-driven mode ──────────────────────────────────────────────────
    if (useSettings && settingsRaw) {
      const contactsResult = await resolveContacts(settingsRaw, _ctx.abortSignal)
      if ('error' in contactsResult) return { output: contactsResult.error, isError: true }

      const target_date = new Date(Date.now() - settingsRaw.days * 86_400_000)
        .toISOString().slice(0, 10)

      const sections: string[] = []
      for (const contact of contactsResult) {
        if (_ctx.abortSignal?.aborted) break   // Ctrl+C：停止读取剩余联系人
        // Omit max_scrolls — let the Python side scale the safety cap to the day span.
        const result = await runOcr({ contact, navigate: true, target_date }, _ctx.abortSignal)
        if (result['error']) {
          sections.push(`## ${contact}\nError: ${result['error']}`)
          continue
        }
        const text = String(result['text'] ?? '')
        if (!text.trim()) {
          sections.push(`## ${contact}\n（未找到消息）`)
          continue
        }
        const focusNote = result['lost_focus'] ? ', ⚠️微信被切走导致读取提前结束' : ''
        const meta = `[滚动次数: ${result['scroll_count'] ?? 0}, 到达目标日期: ${result['reached_target'] ?? false}${focusNote}]`
        sections.push(`## ${contact}\n${meta}\n${text}`)
      }

      const rawText = sections.join('\n\n---\n\n')
      const summaryPrompt = buildSummarizationPrompt(rawText, contactsResult, settingsRaw)

      return {
        output: [
          '聊天记录已收集完毕，请按以下指令生成摘要：',
          '',
          summaryPrompt,
        ].join('\n'),
      }
    }

    // ── Manual mode ───────────────────────────────────────────────────────────
    const singleContact = input['contact']   as string | undefined
    const multiContacts = input['contacts']  as string[] | undefined
    const target_date   = input['target_date'] as string | undefined
    const max_scrolls   = input['max_scrolls'] as number | undefined

    const contactList = multiContacts?.length ? multiContacts
      : singleContact ? [singleContact] : []

    if (contactList.length === 0)
      return { output: 'Provide contact, contacts[], or use_settings=true.', isError: true }

    const sections: string[] = []
    for (const contact of contactList) {
      if (_ctx.abortSignal?.aborted) break
      const result = await runOcr({ contact, navigate: true, target_date, max_scrolls }, _ctx.abortSignal)
      if (result['error']) {
        sections.push(`## ${contact}\nError: ${result['error']}`)
        continue
      }
      const text = String(result['text'] ?? '')
      if (!text.trim()) {
        sections.push(`## ${contact}\nNo text found.`)
        continue
      }
      const meta = `[scrolls: ${result['scroll_count'] ?? 0}, reached_target: ${result['reached_target'] ?? false}]`
      sections.push(`## ${contact}\n${meta}\n${text}`)
    }

    return { output: sections.join('\n\n---\n\n') }
  },
}

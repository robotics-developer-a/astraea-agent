// WebBrowserTool — 浏览器交互工具（当前为降级实现）
// 参考文档: Astraea Development/v1.0/工具系统/网络执行层/WebBrowserTool 教学文档.md
//
// 设计原则：运行时不可用时返回说明性内容而非抛出异常，
// 让 LLM 可以理解限制并引导用户使用 WebFetch 替代。
import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult } from '../Tool.js'
import { confirmWithUser } from '../BashTool/permissions/confirm.js'

type BrowserAction = 'navigate' | 'screenshot' | 'click' | 'type' | 'scroll'

const DEFAULT_ACTION_TIMEOUT_MS = 8000
const MAX_ACTION_TIMEOUT_MS = 15000
const MAX_RESULT_CONTENT_CHARS = 4000

// BrowserDriver 接口 — 真实浏览器引擎的抽象层
// 在 Astraea 获得浏览器运行时后，注入实现此接口的驱动即可
export interface BrowserDriver {
  isAvailable(): boolean
  navigate(url: string): Promise<{ title: string; url: string; content: string }>
  screenshot(): Promise<string>
  click(selector: string): Promise<{ title: string; url: string; content: string }>
  type(selector: string, text: string): Promise<{ title: string; url: string; content: string }>
  scroll(): Promise<{ title: string; url: string; content: string }>
}
let _driver: BrowserDriver | null = null
let _initAttempted = false

export function injectBrowserDriver(driver: BrowserDriver): void {
  _driver = driver
  _initAttempted = true
}
export function resetBrowserDriver(): void {
  _driver = null
  _initAttempted = false
}

function parseTimeoutMs(value: unknown): number {
  const requested = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_ACTION_TIMEOUT_MS
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_ACTION_TIMEOUT_MS)
}

async function withActionTimeout<T>(action: BrowserAction, timeoutMs: number, task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`WebBrowser ${action} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function limitContent(content: string): string {
  if (content.length <= MAX_RESULT_CONTENT_CHARS) return content
  const omitted = content.length - MAX_RESULT_CONTENT_CHARS
  return `${content.slice(0, MAX_RESULT_CONTENT_CHARS)}\n\n[WebBrowser] 内容已截断，省略 ${omitted} 字符。`
}

function pageOutput(prefix: string, state: { title?: string; url?: string; content: string }): string {
  const title = state.title ? `\n标题：${state.title}` : ''
  const url = state.url ? ` → ${state.url}` : ''
  return `[WebBrowser] ${prefix}${url}${title}\n\n${limitContent(state.content)}`
}

async function lazyInit(): Promise<void> {
  if (_initAttempted) return
  _initAttempted = true
  try {
    const { createPlaywrightDriver } = await import('./PlaywrightDriver.js')
    _driver = await createPlaywrightDriver()
  } catch {
    // playwright not installed or browser binaries missing — remain unavailable
  }
}
export const WebBrowserTool = buildTool({
  name: 'WebBrowser',
  description: `Interact with web pages using an embedded browser: navigate, screenshot, click, type, scroll.

Use for JavaScript-heavy SPAs, authenticated pages, or UI interaction testing.
NOTE: Requires browser runtime. If unavailable, use WebFetch for static content instead.`,
  isReadOnly: input => !['click', 'type'].includes(String(input['action'] ?? 'navigate')),
  isConcurrencySafe: input => !['click', 'type'].includes(String(input['action'] ?? 'navigate')),
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to operate on',
      },
      action: {
        type: 'string',
        enum: ['navigate', 'screenshot', 'click', 'type', 'scroll'],
        description: 'Browser action to perform (default: navigate)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for click or type actions',
      },
      text: {
        type: 'string',
        description: 'Text to input, used with action=type',
      },
      timeoutMs: {
        type: 'number',
        description: `Maximum time for this browser action in milliseconds (default ${DEFAULT_ACTION_TIMEOUT_MS}, max ${MAX_ACTION_TIMEOUT_MS})`,
      },
    },
    required: ['url'],
  },

  async call(input, ctx: import("../Tool.js").ToolContext): Promise<ToolCallResult> {
    const url = input['url'] as string
    const action = (input['action'] as BrowserAction | undefined) ?? 'navigate'
    const selector = input['selector'] as string | undefined
    const text = input['text'] as string | undefined
    const timeoutMs = parseTimeoutMs(input['timeoutMs'])

    if (action === 'click' && !selector) return { output: 'Error: click 操作需要提供 selector', isError: true }
    if (action === 'type' && !selector) return { output: 'Error: type 操作需要提供 selector', isError: true }
    if (action === 'type' && text === undefined) return { output: 'Error: type 操作需要提供 text', isError: true }

    await lazyInit()

    const driver = _driver
    if (!driver || !driver.isAvailable()) {
      return {
        output: [
          `[WebBrowser] 浏览器运行时不可用 (browser runtime unavailable)。`,
          `URL: ${url}  Action: ${action}`,
          '',
          'Playwright 未安装或浏览器二进制缺失 (Playwright not installed or browser binaries missing)。',
          'Run: bun add playwright && bunx playwright install chromium',
          '降级方案：改用 WebFetch 抓取静态内容 (fall back to WebFetch for static content)。',
        ].join('\n'),
        isError: false,
      }
    }

    if ((action === 'click' || action === 'type') && ctx.mode !== 'forge') {
      if (ctx.isInteractive !== true) {
        return { output: `Browser ${action} requires confirmation, but no interactive user is available.`, isError: true }
      }
      const confirmation = await confirmWithUser(
        `WebBrowser ${action}: ${selector}`,
        `External web action on ${url}`,
        'action',
      )
      if (!confirmation.proceed) return { output: `Browser ${action} cancelled by user.`, isError: true }
    }

    try {
      switch (action) {
        case 'navigate': {
          const state = await withActionTimeout(action, timeoutMs, driver.navigate(url))
          return { output: pageOutput('navigate', state) }
        }
        case 'screenshot': {
          const base64 = await withActionTimeout(action, timeoutMs, driver.screenshot())
          // INTENT: Screenshots are binary evidence, not readable transcript text.
          // Returning raw Base64 makes the TUI reserve a huge blank-looking result block,
          // so the tool reports the capture metadata and keeps the conversation compact.
          return { output: `[WebBrowser] screenshot 完成（Base64 PNG，${base64.length} 字符，内容已折叠不显示）` }
        }
        case 'click': {
          const state = await withActionTimeout(action, timeoutMs, driver.click(selector!))
          return { output: pageOutput(`click "${selector}"`, state) }
        }
        case 'type': {
          const state = await withActionTimeout(action, timeoutMs, driver.type(selector!, text!))
          return { output: pageOutput(`type "${text}" into "${selector}" 完成`, state) }
        }
        case 'scroll': {
          const state = await withActionTimeout(action, timeoutMs, driver.scroll())
          return { output: pageOutput('scroll 完成', state) }
        }
        default:
          return { output: `Error: 未知 action "${action}"`, isError: true }
      }
    } catch (err: unknown) {
      return { output: `Browser error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

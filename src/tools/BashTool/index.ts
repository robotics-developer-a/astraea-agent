// BashTool 主入口 — 文档 §六 完整架构
// 调用顺序: 安全检查 → 只读放行 → 规则引擎 → 用户确认 → 执行
import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { checkCommandSecurity } from './security/injection-check.js'
import { isReadOnlyCommand } from './security/readonly-check.js'
import { matchRule, DEFAULT_RULES, type PermissionRule } from './permissions/permission-rules.js'
import { confirmWithUser } from './permissions/confirm.js'
import { loadPermissionRules, appendPermissionRule } from '../../config/permissions.js'
import { shellAskBehavior, type PermissionBehavior } from '../../state/sessionMode.js'
import { commandTouchesSensitivePath } from '../../config/redlines.js'
import { executeBash, executeStreamingBash } from './executor/shell.js'
import { syncCwd } from './executor/cwd-tracker.js'
import { spawnBackground, getTask } from './executor/background-task.js'
import { getCurrentCwd } from './executor/cwd-tracker.js'

// ── 运行时追加的规则（代码层调用，优先级最高）────────────────────────────────
const runtimeRules: PermissionRule[] = []

export function addPermissionRule(rule: PermissionRule): void {
  runtimeRules.unshift(rule)
}

// ── 配置文件规则（懒加载，首次 call 时读取）──────────────────────────────────
let configRules: PermissionRule[] = []
let configLoaded = false

async function ensureConfigLoaded(): Promise<void> {
  if (configLoaded) return
  configLoaded = true
  try {
    configRules = await loadPermissionRules(process.cwd())
  } catch {
    configRules = []
  }
}

interface ShellPermissionOutcome {
  proceed: boolean
  /** 当 proceed=false 时的拒绝说明。 */
  rejection?: string
}

/**
 * 解析一条（非只读）命令的 shell 权限（Permission & Safety Technical Spec §1.3 / §3.0 / §5）。
 * 取向：deny 规则 → 拒绝；allow 规则 → 放行；ask 规则或未命中 → 按模式（forge=allow，其余=ask）。
 * 红线：触碰敏感路径的命令即便 forge 也强制 ask。ask 在无人在场时 fail-closed deny，绝不阻塞。
 */
async function resolveShellPermission(
  command: string,
  description: string | undefined,
  ctx: ToolContext,
): Promise<ShellPermissionOutcome> {
  // 规则优先级：运行时追加 > 配置文件 > 内置默认
  const allRules = [...runtimeRules, ...configRules, ...DEFAULT_RULES]
  const ruleAction = matchRule(command, allRules)

  // deny 一票否决
  if (ruleAction === 'deny') {
    return { proceed: false, rejection: `Command denied by permission rules: \`${command}\`` }
  }

  // allow 规则 → 放行；ask 规则或未命中(null) → 按模式取向（forge=allow，其余=ask）
  let behavior: PermissionBehavior = ruleAction === 'allow' ? 'allow' : shellAskBehavior(ctx.mode)

  // 红线：非只读命令触碰敏感路径 → 即便 forge 也强制 ask
  if (behavior === 'allow' && commandTouchesSensitivePath(command)) behavior = 'ask'

  if (behavior === 'allow') return { proceed: true }

  // behavior === 'ask'：无人在场则 fail-closed deny，绝不挂起
  if (ctx.isInteractive !== true) {
    return {
      proceed: false,
      rejection: `Command requires confirmation, but no interactive user is available (fail-closed deny): \`${command}\`. Pre-allow it in .astraea/settings.json, or run interactively.`,
    }
  }

  const confirm = await confirmWithUser(command, description)

  if (confirm.remember === 'always-deny') {
    await appendPermissionRule(process.cwd(), command, 'deny')
    configRules.unshift({ pattern: command, action: 'deny' })
    return { proceed: false, rejection: `Command denied. Rule saved: deny "${command}"` }
  }

  if (!confirm.proceed) {
    return { proceed: false, rejection: 'Command cancelled by user.' }
  }

  if (confirm.remember === 'always-allow') {
    try {
      await appendPermissionRule(process.cwd(), command, 'allow') // 默认写 local
      configRules.unshift({ pattern: command, action: 'allow' })
    } catch (err) {
      // 红线命令不可持久化为 allow —— 本次放行，但不写规则（防自我提权）
      process.stderr.write(`[BashTool] not persisting allow rule: ${String(err)}\n`)
    }
  }

  return { proceed: true }
}

const TOOL_DESCRIPTION = `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.

## Instructions
- Before creating new directories or files, first use this tool to run \`ls\` to verify the parent directory exists
- Always quote file paths that contain spaces with double quotes
- Try to maintain your current working directory by using absolute paths and avoiding \`cd\`
- You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). Default: 120000ms
- When issuing multiple independent commands, make parallel tool calls in a single message
- Use \`&&\` for sequential dependent commands; \`;\` when earlier failures don't matter

## Git operations
- Prefer creating new commits rather than amending existing ones
- Never skip hooks (--no-verify) unless the user explicitly asks
- NEVER commit changes unless the user explicitly asks you to

## Background tasks
- Set \`run_in_background: true\` for long-running services or monitoring commands
- Query a running task by passing \`background_task_id\` instead of \`command\``

export const BashTool = buildTool({
  name: 'Bash',
  description: TOOL_DESCRIPTION,
  isReadOnly: (input) => isReadOnlyCommand(String(input['command'] ?? '')),
  isConcurrencySafe: (input) => isReadOnlyCommand(String(input['command'] ?? '')),
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute. Omit when querying a background task.',
      },
      description: {
        type: 'string',
        description: 'Short description of what this command does (shown to user during confirmation).',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (max 600000). Default: 120000.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run command in background and return a task ID immediately.',
      },
      background_task_id: {
        type: 'string',
        description: 'Query the output of a previously started background task.',
      },
    },
    required: [],
  },

  async call(input, ctx: ToolContext): Promise<ToolCallResult> {
    // ── 0. 后台任务查询 ──────────────────────────────────────────────
    const taskId = input['background_task_id'] as string | undefined
    if (taskId) {
      const task = getTask(taskId)
      if (!task) {
        return { output: `No background task found with id: ${taskId}`, isError: true }
      }
      const status = task.exitCode === null ? 'running' : `exited ${task.exitCode}`
      return {
        output: [
          `Task ${task.id} [${status}]`,
          task.stdout && `stdout:\n${task.stdout}`,
          task.stderr && `stderr:\n${task.stderr}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      }
    }

    // ── 1. 输入验证 ───────────────────────────────────────────────────
    const command = input['command'] as string | undefined
    if (!command?.trim()) {
      return { output: 'Error: command is required', isError: true }
    }

    const timeout     = input['timeout'] as number | undefined
    const description = input['description'] as string | undefined
    const runInBg     = Boolean(input['run_in_background'])

    // ── 2. 安全检查（硬阻断）────────────────────────────────────────
    const security = checkCommandSecurity(command)
    if (!security.safe) {
      return {
        output: `Security check blocked: ${security.reason} (check #${security.checkId})`,
        isError: true,
      }
    }

    // ── 3. 只读命令直接放行 ──────────────────────────────────────────
    const readOnly = isReadOnlyCommand(command)
    if (readOnly) {
      return formatResult(await executeBash({ command, timeout }))
    }

    // ── 4. 加载配置文件规则（首次调用时） ───────────────────────────
    await ensureConfigLoaded()

    // ── 5-7. 权限解析：规则 + 模式取向 + 红线 + 交互/fail-closed ────────
    const perm = await resolveShellPermission(command, description, ctx)
    if (!perm.proceed) {
      return { output: perm.rejection!, isError: true }
    }

    // ── 8. 可疑模式警告（safe:true 但有 reason）─────────────────────
    if (security.reason) {
      process.stderr.write(
        `[BashTool warn] suspicious pattern (check #${security.checkId}): ${security.reason}\n`,
      )
    }

    // ── 9. 后台执行 ──────────────────────────────────────────────────
    if (runInBg) {
      const shell = process.env.SHELL?.match(/(bash|zsh)$/) ? process.env.SHELL : '/bin/bash'
      const id = spawnBackground(command, shell, getCurrentCwd(), process.env as Record<string, string>)
      return { output: `Background task started. Task ID: ${id}\nUse background_task_id to query status.` }
    }

    // ── 10. 前台执行 ─────────────────────────────────────────────────
    return formatResult(await executeBash({ command, timeout, description }))
  },

  renderResult(_input, output, isError) {
    if (!output || output === '(no output)') return null
    const lines = output.split('\n')
    const MAX = 40
    const prefix = isError ? '[error]' : '[ok]'
    const header = `${prefix} (${lines.length} lines)`
    // 不再自加缩进——结果体的对齐统一由 ResultLines 的悬挂缩进负责，
    // 否则各工具各加各的前导空格，缩进就会参差（Glob 第 7 列、Bash 原来第 9 列）。
    const body = lines.slice(0, MAX)
    if (lines.length > MAX) body.push(`… (${lines.length - MAX} more lines)`)
    return [header, ...body]
  },

  async *callStream(input, ctx: ToolContext): AsyncGenerator<string, ToolCallResult> {
    const command = input['command'] as string | undefined
    if (!command?.trim()) return { output: 'Error: command is required', isError: true }

    const security = checkCommandSecurity(command)
    if (!security.safe) return { output: `Security check blocked: ${security.reason}`, isError: true }

    if (!isReadOnlyCommand(command)) {
      await ensureConfigLoaded()
      const perm = await resolveShellPermission(command, input['description'] as string | undefined, ctx)
      if (!perm.proceed) return { output: perm.rejection!, isError: true }
    }

    const gen = executeStreamingBash({ command, timeout: input['timeout'] as number | undefined })
    let result: IteratorResult<string, Awaited<ReturnType<typeof executeBash>>>
    do {
      result = await gen.next()
      if (!result.done) yield result.value
    } while (!result.done)

    await syncCwd()
    return formatResult(result.value)
  },
})

// 模型可见输出的字符上限（对照 Claude Code BashTool maxResultSizeChars: 30000）。
// 仅作用于「发给模型的 output」——执行器的 64MB 字节闸（shell.ts MAX_OUTPUT_BYTES）是
// 防进程 OOM，这里这道闸是防上下文爆炸：一次 cat 大文件 / 安装日志 / find / 大 JSON
// 就能灌入几十万 token，触发 reactive compaction 或 413 溢出，把细粒度上下文一刀切毁掉。
// FileReadTool 早有输出 token 闸（limits.ts），输出更不可控的 Bash 此前反而没有。
const MAX_STDOUT_CHARS = 30_000
const MAX_STDERR_CHARS = 10_000

// 超限截断：保留头部 + 尾部，中间挖掉并标注被省略的字符数。
// 取头尾而非纯 head——构建/测试日志的失败摘要常落在末尾，纯头截断会把最关键的信息丢掉。
export function truncateForModel(text: string, limit: number): string {
  if (text.length <= limit) return text
  const headLen = Math.floor(limit * 0.7)
  const tailLen = limit - headLen
  const head = text.slice(0, headLen)
  const tail = text.slice(text.length - tailLen)
  const omitted = text.length - headLen - tailLen
  return `${head}\n\n... [${omitted} characters truncated — re-run a narrower command or pipe through head/grep/tail to see specific parts] ...\n\n${tail}`
}

function formatResult(result: Awaited<ReturnType<typeof executeBash>>): ToolCallResult {
  const parts: string[] = []
  if (result.stdout) parts.push(truncateForModel(result.stdout, MAX_STDOUT_CHARS))
  if (result.stderr) parts.push(`[stderr]\n${truncateForModel(result.stderr, MAX_STDERR_CHARS)}`)
  if (result.timedOut)   parts.push('[timed out]')
  if (result.interrupted) parts.push('[interrupted]')

  return {
    output: parts.join('\n').trim() || '(no output)',
    isError: result.exitCode !== 0,
  }
}

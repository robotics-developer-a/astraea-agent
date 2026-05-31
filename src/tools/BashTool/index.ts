// BashTool 主入口 — 文档 §六 完整架构
// 调用顺序: 安全检查 → 只读放行 → 规则引擎 → 用户确认 → 执行
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { checkCommandSecurity } from './security/injection-check.js'
import { isReadOnlyCommand } from './security/readonly-check.js'
import { matchRule, DEFAULT_RULES, type PermissionRule } from './permissions/permission-rules.js'
import { confirmWithUser } from './permissions/confirm.js'
import { loadPermissionRules, appendPermissionRule } from '../../config/permissions.js'
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

export const BashTool: Tool = {
  name: 'Bash',
  description: TOOL_DESCRIPTION,
  isReadOnly: false,
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

    // ── orbit 模式：非只读命令 → 拦截 ───────────────────────────────
    if (ctx.mode === 'orbit') {
      return {
        output: `[orbit mode] Write command blocked: \`${command}\`. Use ExitOrbitMode to present your plan and request approval first.`,
        isError: true,
      }
    }

    // ── 4. 加载配置文件规则（首次调用时） ───────────────────────────
    await ensureConfigLoaded()

    // 规则优先级：运行时追加 > 配置文件 > 内置默认
    const allRules = [...runtimeRules, ...configRules, ...DEFAULT_RULES]
    const ruleAction = matchRule(command, allRules)

    // ── 5. deny → 直接拒绝 ───────────────────────────────────────────
    if (ruleAction === 'deny') {
      return {
        output: `Command denied by permission rules: \`${command}\``,
        isError: true,
      }
    }

    // ── 6. allow / forge → 跳过确认，直接执行 ───────────────────────
    // （ruleAction === null 也跳过确认，保持宽松默认行为）

    // ── 7. ask → 弹出终端确认框（forge 模式跳过）───────────────────
    if (ruleAction === 'ask' && ctx.mode !== 'forge') {
      const confirm = await confirmWithUser(command, description)

      if (confirm.remember === 'always-deny') {
        await appendPermissionRule(process.cwd(), command, 'deny')
        configRules.unshift({ pattern: command, action: 'deny' })
        return {
          output: `Command denied. Rule saved: deny "${command}"`,
          isError: true,
        }
      }

      if (!confirm.proceed) {
        return { output: 'Command cancelled by user.', isError: true }
      }

      if (confirm.remember === 'always-allow') {
        await appendPermissionRule(process.cwd(), command, 'allow')
        configRules.unshift({ pattern: command, action: 'allow' })
      }
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
    const body = lines.slice(0, MAX).map(l => `  ${l}`)
    if (lines.length > MAX) body.push(`  … (${lines.length - MAX} more lines)`)
    return [header, ...body]
  },

  async *callStream(input, ctx: ToolContext): AsyncGenerator<string, ToolCallResult> {
    const command = input['command'] as string | undefined
    if (!command?.trim()) return { output: 'Error: command is required', isError: true }

    const security = checkCommandSecurity(command)
    if (!security.safe) return { output: `Security check blocked: ${security.reason}`, isError: true }

    if (!isReadOnlyCommand(command)) {
      if (ctx.mode === 'orbit') {
        return {
          output: `[orbit mode] Write command blocked: \`${command}\`. Use ExitOrbitMode first.`,
          isError: true,
        }
      }
      await ensureConfigLoaded()
      const allRules = [...runtimeRules, ...configRules, ...DEFAULT_RULES]
      const ruleAction = matchRule(command, allRules)
      if (ruleAction === 'deny') return { output: `Command denied: \`${command}\``, isError: true }
      if (ruleAction === 'ask' && ctx.mode !== 'forge') {
        const confirm = await confirmWithUser(command, input['description'] as string | undefined)
        if (!confirm.proceed) return { output: 'Command cancelled by user.', isError: true }
        if (confirm.remember === 'always-allow') {
          await appendPermissionRule(process.cwd(), command, 'allow')
          configRules.unshift({ pattern: command, action: 'allow' })
        }
      }
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
}

function formatResult(result: Awaited<ReturnType<typeof executeBash>>): ToolCallResult {
  const parts: string[] = []
  if (result.stdout) parts.push(result.stdout)
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
  if (result.timedOut)   parts.push('[timed out]')
  if (result.interrupted) parts.push('[interrupted]')

  return {
    output: parts.join('\n').trim() || '(no output)',
    isError: result.exitCode !== 0,
  }
}

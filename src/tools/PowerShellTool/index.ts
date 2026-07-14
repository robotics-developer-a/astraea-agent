import { buildTool } from '../Tool.js'
import type { ToolCallResult, ToolContext } from '../Tool.js'
import { executePowerShell } from './executor/powershell.js'
import { matchRule, DEFAULT_RULES, type PermissionRule } from '../BashTool/permissions/permission-rules.js'
import { confirmWithUser } from '../BashTool/permissions/confirm.js'
import { loadPermissionRules, appendPermissionRule } from '../../config/permissions.js'
import { checkCommandSecurity } from './security/injection-check.js'
import { isReadOnlyPowerShellCommand } from './security/readonly-check.js'
import { shellAskBehavior, type PermissionBehavior } from '../../state/sessionMode.js'
import { commandTouchesSensitivePath } from '../../config/redlines.js'
const runtimeRules: PermissionRule[] = []

export function addPsPermissionRule(rule: PermissionRule): void {
  runtimeRules.unshift(rule)
}
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
const TOOL_DESCRIPTION = `Executes a PowerShell (pwsh) command and returns its output.

This is the shell tool for Windows. On macOS/Linux the Bash tool is exposed instead; this tool only appears there if explicitly configured (requires PowerShell 7+, install via: brew install --cask powershell).

## Instructions
- Use PowerShell cmdlets and syntax (Get-ChildItem, Set-Content, etc.)
- Prefer pipeline idioms over loops where possible
- Quote paths with spaces using single quotes inside the command
- You may specify an optional timeout in milliseconds (up to 600000ms). Default: 120000ms
- Working directory starts from the current session directory

## Differences from Bash
- No background tasks (run_in_background / background_task_id are not supported)
- Long output is returned as-is without Bash's truncation summary`

interface PowerShellPermissionOutcome {
  proceed: boolean
  rejection?: string
}

async function resolvePowerShellPermission(
  command: string,
  description: string | undefined,
  ctx: ToolContext,
  securityBehavior: 'ask' | 'pass',
): Promise<PowerShellPermissionOutcome> {
  await ensureConfigLoaded()

  const allRules = [...runtimeRules, ...configRules, ...DEFAULT_RULES]
  const ruleAction = matchRule(command, allRules)

  if (ruleAction === 'deny') {
    return { proceed: false, rejection: `Command denied by permission rules: \`${command}\`` }
  }

  // INTENT: PowerShell follows the same session-mode contract as Bash: forge
  // auto-accepts commands that would otherwise ask, while block-tier security
  // checks have already returned before this function is reached.
  let behavior: PermissionBehavior =
    ruleAction === 'allow' && securityBehavior !== 'ask'
      ? 'allow'
      : shellAskBehavior(ctx.mode)

  // INTENT: Mode bypass must not silently modify the permission system or user
  // shell startup surface. This mirrors BashTool's bypass-immune redline.
  if (behavior === 'allow' && commandTouchesSensitivePath(command)) {
    behavior = 'ask'
  }

  if (behavior === 'allow') {
    return { proceed: true }
  }

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
    await appendPermissionRule(process.cwd(), command, 'allow')
    configRules.unshift({ pattern: command, action: 'allow' })
  }

  return { proceed: true }
}

export const PowerShellTool = buildTool({
  name: 'PowerShell',
  description: TOOL_DESCRIPTION,
  // 只读命令识别(审计 T8):恒 false 时 Windows 子代理(fail-closed)连 Get-ChildItem
  // 都被拒。与 Bash 同款按命令内容动态判定;识别不出仍保守判写。
  isReadOnly: (input) => isReadOnlyPowerShellCommand(String(input['command'] ?? '')),
  isConcurrencySafe: (input) => isReadOnlyPowerShellCommand(String(input['command'] ?? '')),
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The PowerShell command or script block to execute.',
      },
      description: {
        type: 'string',
        description: 'Short description of what this command does (shown to user during confirmation).',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (max 600000). Default: 120000.',
      },
    },
    required: ['command'],
  },

  async call(input, ctx: ToolContext): Promise<ToolCallResult> {
    const command = input['command'] as string | undefined
    if (!command?.trim()) {
      return { output: 'Error: command is required', isError: true }
    }

    const timeout     = input['timeout'] as number | undefined
    const description = input['description'] as string | undefined

    // Safety check (PowerShell injection / dangerous-cmdlet line). Three tiers,
    // mirroring claude-code's powershellSecurity: block | ask | pass.
    const security = checkCommandSecurity(command)
    if (security.behavior === 'block') {
      return {
        output: `Security check blocked: ${security.reason} (check #${security.checkId})`,
        isError: true,
      }
    }

    // 只读命令直接放行(对齐 Bash 流程):安全检查已过、无副作用,无需权限确认。
    // 关键场景:Windows 子代理 isInteractive=false,没有这条通路则一切命令 fail-closed 全拒。
    if (security.behavior === 'pass' && isReadOnlyPowerShellCommand(command)) {
      return formatPsResult(await executePowerShell({ command, timeout, description }, ctx.abortSignal))
    }

    const permission = await resolvePowerShellPermission(command, description, ctx, security.behavior)
    if (!permission.proceed) {
      if (security.behavior === 'ask') {
        process.stderr.write(
          `[PowerShell] dangerous pattern (check #${security.checkId}): ${security.reason}\n`,
        )
      }
      return { output: permission.rejection ?? 'Command cancelled by user.', isError: true }
    }

    return formatPsResult(await executePowerShell({ command, timeout, description }, ctx.abortSignal))
  },
})

function formatPsResult(result: Awaited<ReturnType<typeof executePowerShell>>): ToolCallResult {
  const parts: string[] = []
  if (result.stdout) parts.push(result.stdout)
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
  if (result.timedOut) parts.push('[timed out]')
  if (result.interrupted) parts.push('[interrupted by user]')

  return {
    output: parts.join('\n').trim() || '(no output)',
    isError: result.exitCode !== 0,
  }
}

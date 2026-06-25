// 内置命令迁移到统一命令表 —— 实现文档 §1.2/§1.9。
// 内置与 skill 同住 getCommands() 一张表；内置一律 userInvocable、绝不 modelInvocable。
//
// 分类：
//   local-jsx（派发 action tag，App reducer 执行）：/mode //goal /wechat /vigil /login
//                                                  /clear /compact /resume /mcp /plugin
//   local（表内直接跑，返回文本）：/help //model
//
// 迁移策略：App.tsx 收到 slash → findCommand() → 对 local-jsx 把 toAction() 交给 reducer；
// 对 local 调 run() 显示文本。既有面板组件复用，只是触发点统一。

import { config, activeContextWindow } from '../config'
import type { Command, LocalJsxCommand, LocalCommand, PromptCommand, CommandAction } from './types'
import type { TextBlock } from '../types/message'
import { getUsageStats } from '../state/usageStats'
import { renderUsage } from './usageRender'

function jsx(
  name: string,
  description: string,
  toAction: (args: string | undefined) => CommandAction,
  opts: { argumentHint?: string; hidden?: boolean } = {},
): LocalJsxCommand {
  return {
    type: 'local-jsx',
    name,
    description,
    source: 'builtin',
    userInvocable: true,
    modelInvocable: false,
    argumentHint: opts.argumentHint,
    hidden: opts.hidden,
    toAction,
  }
}

function local(
  name: string,
  description: string,
  run: LocalCommand['run'],
  opts: { argumentHint?: string } = {},
): LocalCommand {
  return {
    type: 'local',
    name,
    description,
    source: 'builtin',
    userInvocable: true,
    modelInvocable: false,
    argumentHint: opts.argumentHint,
    run,
  }
}

function prompt(
  name: string,
  description: string,
  getPrompt: PromptCommand['getPrompt'],
  opts: { argumentHint?: string; allowedTools?: string[] } = {},
): PromptCommand {
  return {
    type: 'prompt',
    name,
    description,
    source: 'builtin',
    userInvocable: true,
    modelInvocable: false,
    argumentHint: opts.argumentHint,
    allowedTools: opts.allowedTools,
    getPrompt,
  }
}

function initPrompt(args: string | undefined): TextBlock[] {
  const argLine = args?.trim()
    ? `\n\nUser-supplied /init focus or constraints:\n${args.trim()}`
    : ''

  return [{ type: 'text', text: `Set up Astraea project instructions for this repository.

You are running inside Astraea, not Claude Code. Astraea loads project instructions from AGENTS.md and AGENTS.local.md. Do not create CLAUDE.md. If CLAUDE.md already exists, read it only as source material and migrate relevant guidance into AGENTS.md or AGENTS.local.md.

## Phase 1: Ask what to set up

Use AskUserQuestion before writing files. Ask which Astraea instruction files the user wants:
- Project AGENTS.md: team-shared instructions checked into source control.
- Personal AGENTS.local.md: private project preferences, gitignored.
- Both project + personal.

Also ask whether to set up project skills:
- Skills + AGENTS.md notes.
- Skills only.
- Neither, just AGENTS.md / AGENTS.local.md.

Astraea does not currently have a Claude-Code-style hooks manager. Do not invent hook config. If the user asks for deterministic automation, propose a project skill or an ordinary repository script instead.

## Phase 2: Explore the codebase

Survey the repository before asking follow-up questions. Read the high-signal files that exist:
- Manifest and tooling files: package.json, bun.lock, tsconfig.json, biome.json, eslint/prettier configs, pyproject.toml, Cargo.toml, go.mod, Makefile.
- README and docs.
- Existing AGENTS.md, AGENTS.local.md, CLAUDE.md, .cursor/rules, .cursorrules, .github/copilot-instructions.md, .windsurfrules, .clinerules.
- Existing .astraea/skills and .mcp.json.
- CI config under .github/workflows.

Detect:
- build, test, and lint commands, especially non-standard commands and single-test commands.
- package manager and runtime. Default to Bun in JavaScript/TypeScript projects: bun install, bun test, bun run <script>, bun <file>, bunx <package>.
- project structure and major architectural boundaries.
- coding conventions that differ from language defaults.
- required environment variables or local setup steps.
- repository-specific gotchas and verification habits.
- branch, commit, release, PR, and tag conventions if documented.

Do not ask the user anything you can discover from files.

## Phase 3: Fill in only real gaps

Ask concise follow-up questions only for facts the repository does not reveal. Good questions include:
- Which commands should be considered the canonical full verification path?
- Are there private sandbox URLs, test accounts, or local paths that belong in AGENTS.local.md?
- Are there release/tag/PR conventions not documented in the repo?
- How detailed should Astraea be when explaining changes in this project?

Show a compact proposal before writing. The proposal should list each target file and the exact kind of content you will add.

## Phase 4: Write AGENTS.md

If the user chose project instructions, create or update AGENTS.md at the repository root. If it already exists, preserve useful content and make focused additions instead of overwriting.

Every line must pass this test: "Would removing this make Astraea more likely to make a mistake in this repo?" If not, omit it.

Include:
- non-obvious build/test/lint/typecheck commands.
- exact single-test commands when discoverable.
- project-specific architecture notes that help navigation.
- conventions, repo etiquette, release/tag rules, and required verification.
- important AI-tool rules discovered in existing config files.
- references to long docs using paths instead of copying large content.

Exclude:
- generic advice.
- file-by-file inventories.
- long tutorials.
- unstable information better read from source files.
- secrets or credentials.

Start new AGENTS.md files with:

# AGENTS.md

This file provides guidance to Astraea when working in this repository.

## Phase 5: Write AGENTS.local.md

If the user chose personal instructions, create or update AGENTS.local.md. Keep it private and short:
- user role and familiarity.
- personal preferences for communication or review depth.
- private local setup hints, sandbox URLs, or test accounts.

Ensure AGENTS.local.md is listed in .gitignore. Do not put personal imports or private paths in AGENTS.md.

## Phase 6: Create project skills when useful

If the user chose skills, create focused project skills under .astraea/skills/<skill-name>/SKILL.md. Prefer skills for repeatable workflows such as verify, release, deploy, review, migration, or subsystem-specific rules.

Each SKILL.md must include frontmatter:

---
name: <skill-name>
description: <what it does and when to use it>
---

Then write concrete instructions using this repository's real commands and paths. Do not overwrite existing skills.

## Phase 7: Verify

After edits:
- read back every file you changed.
- run the lightest relevant verification command available in the repo. For this Astraea repo, prefer bun test for tests.
- report exactly what was created or updated and what still needs the user's review.

Safety:
- Never fabricate commands, architecture, or conventions.
- Never touch unrelated files.
- Never commit unless the user explicitly confirms the exact tag/version for this change.
${argLine}` }]
}

let _commandsForHelp: () => Command[] = () => []
/** registry 注入：让 /help 能列出全表（避免循环依赖）。 */
export function _setHelpCommandSource(fn: () => Command[]) {
  _commandsForHelp = fn
}

export function getBuiltinCommands(): Command[] {
  return [
    prompt('init', 'analyze this repo and create/update AGENTS.md project instructions',
      async args => initPrompt(args),
      { argumentHint: '[focus]' }),

    jsx('mode', 'select session mode: orbit · cruise · forge · counsel · default',
      args => (args?.trim() ? { kind: 'switch-mode', args: args.trim() } : { kind: 'open-mode-panel' }),
      { argumentHint: '[orbit|cruise|forge|counsel|default]' }),

    jsx('goal', 'set a completion condition to work toward',
      args => ({ kind: 'set-goal', args }), { argumentHint: '<condition> | clear' }),

    jsx('wechat', 'summarize WeChat chats now', () => ({ kind: 'wechat-run' }), { hidden: true }),

    jsx('vigil', 'scheduled tasks', () => ({ kind: 'open-vigil-panel' }),
      { argumentHint: '[add|list|delete|wechat]' }),

    jsx('login', 'set API key and provider', () => ({ kind: 'login-wizard' })),

    jsx('internet', 'configure web search provider (Bocha/Zhipu/Tavily…)', () => ({ kind: 'internet-wizard' })),

    jsx('search', 'configure web search provider (alias of /internet)', () => ({ kind: 'internet-wizard' }), { hidden: true }),

    jsx('language', 'choose UI & reply language (en/de/fr/es/zh/ko)',
      args => ({ kind: 'language-wizard', args: args?.trim() }), { argumentHint: '[en|de|fr|es|zh|ko]' }),

    jsx('clear', 'clear conversation history', () => ({ kind: 'clear-history' })),

    local('rename', 'rename the current session',
      async () => ({ type: 'text', value: 'Usage: /rename <session-name>' }),
      { argumentHint: '<session-name>' }),

    jsx('compact', 'compact context now (optional: /compact <focus>)',
      args => ({ kind: 'compact-now', args }), { argumentHint: '[focus]' }),

    jsx('resume', 'resume a past session', () => ({ kind: 'resume-picker' })),

    jsx('rewind', 'rewind this session: restore conversation + edited files',
      args => ({ kind: 'rewind-picker', args: args?.trim() }), { argumentHint: '[turn#]' }),

    local('mcp', 'show MCP server connection status', async () => {
      const { getMcpStatus, isMcpInitialized } = await import('../mcp/registry')
      if (!isMcpInitialized()) return { type: 'text', value: 'MCP not initialized yet (connecting at startup).' }
      const status = getMcpStatus()
      if (status.length === 0) {
        return { type: 'text', value: 'No MCP servers configured. Add one with `astraea mcp add …`.' }
      }
      const lines = status.map(s =>
        s.state === 'connected'
          ? `  ✓ ${s.name} [${s.transport}, ${s.scope}] — ${s.toolCount} tools`
          : `  ✗ ${s.name} [${s.transport}, ${s.scope}] — failed: ${s.error ?? 'unknown'}`,
      )
      return { type: 'text', value: ['**MCP servers:**', ...lines].join('\n') }
    }),

    local('plugin', 'show installed plugins & marketplaces', async () => {
      const { listInstalled } = await import('../plugins/installedManager')
      const { listMarketplaces } = await import('../plugins/marketplaceManager')
      const records = listInstalled()
      const mps = listMarketplaces()
      const parts: string[] = []
      parts.push('**Marketplaces:**')
      parts.push(mps.length ? mps.map(m => `  ${m.name} (${m.pluginCount} plugins)`).join('\n') : '  (none — add with `astraea plugin marketplace add <dir>`)')
      parts.push('', '**Installed plugins:**')
      parts.push(records.length ? records.map(r => `  ${r.enabled ? '✓' : '○'} ${r.pluginId} v${r.version} [${r.scope}]`).join('\n') : '  (none)')
      return { type: 'text', value: parts.join('\n') }
    }),

    local('reload-plugins', 'hot-reload skills & plugins (no restart needed)', async () => {
      const { reloadPlugins } = await import('../plugins/init')
      const { getCommands } = await import('./registry')
      const status = reloadPlugins()
      const skills = getCommands().filter(c => c.source !== 'builtin')
      const bySource = (s: string) => skills.filter(c => c.source === s).length
      const loaded = status.filter(s => s.state === 'loaded')
      const failed = status.filter(s => s.state === 'failed')
      // verdict header + indigo-bordered dashboard table
      const parts: string[] = []
      if (failed.length === 0) {
        parts.push(`⟦ok⟧ Reloaded — ${loaded.length} plugin${loaded.length === 1 ? '' : 's'} · ${skills.length} skill${skills.length === 1 ? '' : 's'} · all nominal.`)
      } else {
        parts.push(`⟦warn⟧ Reloaded — ${loaded.length} loaded · ${failed.length} failed.`)
      }
      parts.push('')
      parts.push('| Reload Results                | Skills & Plugins          |')
      parts.push('| :--------------------------- | :------------------------ |')
      parts.push(`| Skills available             | ${skills.length}  (u:${bySource('user')} · p:${bySource('project')} · plugin:${bySource('plugin')}) |`)
      parts.push(`| Plugins loaded               | ${loaded.length} [ok] |`)
      for (const f of failed) {
        parts.push(`| Plugin failed                | [x] ${f.name}: ${f.error ?? 'unknown'} |`)
      }
      parts.push('| New skills take effect       | [ok] from next message     |')
      parts.push('| MCP server connections       | [~] restart to reconnect   |')
      return { type: 'text', value: parts.join('\n') }
    }),

    local('reason', 'set reasoning effort: low · medium · high · max · auto',
      async args => {
        const { executeReason, persistReason } = await import('./reason')
        const r = executeReason(args)
        await persistReason(r)
        return { type: 'text', value: r.message }
      },
      { argumentHint: '[low|medium|high|max|auto]' }),

    local('model', 'show current provider, model, and endpoint', async () => {
      const p = config.provider
      const providerCfg = (config as unknown as Record<string, { model?: string; endpoint?: string }>)[p]
      const model = providerCfg?.model ?? 'unknown'
      const endpoint = providerCfg?.endpoint ?? ''
      const ctx = activeContextWindow().toLocaleString()
      const parts = ['**Model configuration**', '']
      parts.push('| Key | Value |')
      parts.push('|---|---|')
      parts.push(`| Provider | ${p} |`)
      parts.push(`| Model | ${model} |`)
      if (endpoint) parts.push(`| Endpoint | ${endpoint} |`)
      parts.push(`| Context window | ${ctx} tokens |`)
      return { type: 'text', value: parts.join('\n') }
    }),

    local('usage', 'show session token usage & cost (USD)', async () => {
      return { type: 'text', value: renderUsage(getUsageStats()) }
    }),

    local('audit', 'review permission allow/deny decisions (with structured reason)',
      async args => {
        const { parseAuditArgs, loadSessionAudit, loadProjectAudit, formatAuditTable } = await import('../audit/query')
        const { getAuditSession } = await import('../audit/record')
        const { scope, filter, limit } = parseAuditArgs(args)
        const all = scope === 'project'
          ? loadProjectAudit(process.cwd(), filter)
          : loadSessionAudit(process.cwd(), getAuditSession(), filter)
        // 分页：默认只铺最近 limit 条（最新在底部），--all / --limit N 可改。
        const shown = limit != null && all.length > limit ? all.slice(-limit) : all
        return { type: 'preformatted', value: formatAuditTable(shown, scope, { total: all.length, limit }) }
      },
      { argumentHint: '[--project] [--allow|--deny] [--reason <type>] [--all] [--limit N]' }),

    local('selection', 'floating selection UI: /selection start to launch (bind a shortcut to open it)',
      async args => {
        const sub = (args ?? '').trim().split(/\s+/)[0] || ''
        const { bridgeUrl, isBridgeHealthy, ensureBridgeRunning, stopBridge } = await import('../services/selection-bridge-client')

        if (sub === 'stop') {
          const stopped = await stopBridge()
          return {
            type: 'text',
            value: stopped
              ? '⟦ok⟧ Selection bridge stopped.'
              : '⟦warn⟧ Selection bridge was not running.',
          }
        }

        if (sub === 'status') {
          const ok = await isBridgeHealthy()
          return {
            type: 'text',
            value: ok
              ? `⟦ok⟧ Selection bridge healthy at ${bridgeUrl()}`
              : `⟦err⟧ Selection bridge not reachable at ${bridgeUrl()} — run \`/selection\` to start it.`,
          }
        }

        if (sub === 'setup') {
          const { selectionSetupInstructions } = await import('../services/selection-bridge-client')
          return { type: 'text', value: selectionSetupInstructions() }
        }

        if (sub === 'open') {
          const { runOpenCompanion } = await import('../services/open-selection-companion')
          await runOpenCompanion()
          return { type: 'text', value: '⟦ok⟧ Opened the floating selection panel.' }
        }

        if (sub === 'start') {
          // Lazily start the bridge in the background, then point the user at the
          // keyboard-shortcut workflow that actually opens the UI.
          const already = await isBridgeHealthy()
          await ensureBridgeRunning({ quiet: true })
          return {
            type: 'text',
            value: [
              already
                ? `⟦ok⟧ Selection bridge already running at ${bridgeUrl()}`
                : `⟦ok⟧ Selection bridge started in the background at ${bridgeUrl()}`,
              '',
              'Now bind a keyboard shortcut to open the floating panel — run `/selection setup` for the exact steps.',
              'Other actions: `/selection status` · `/selection open` (open now) · `/selection stop` · `/selection setup`.',
            ].join('\n'),
          }
        }

        // No subcommand (or an unknown one): show usage. Starting is explicit —
        // `/selection start` — so a bare `/selection` never silently launches.
        return {
          type: 'text',
          value: [
            sub ? `⟦warn⟧ Unknown subcommand: ${sub}` : '**/selection** — floating selection UI',
            '',
            '  `/selection start`   start the bridge service in the background',
            '  `/selection open`    capture the selection and open the panel now',
            '  `/selection stop`    stop the bridge service',
            '  `/selection status`  check whether the bridge is running',
            '  `/selection setup`   print the keyboard-shortcut setup steps',
          ].join('\n'),
        }
      },
      { argumentHint: '[start|open|stop|status|setup]' }),

    local('export', 'export current conversation to a Markdown file',
      async args => {
        const { exportConversation } = await import('./export')
        return exportConversation(args)
      },
      { argumentHint: '[filename]' }),

    local('help', 'show available commands', async () => {
      const { t } = await import('../i18n')
      const cmds = _commandsForHelp().filter(c => c.userInvocable && !c.hidden)
      const builtin = cmds.filter(c => c.source === 'builtin')
      const skills = cmds.filter(c => c.source !== 'builtin')
      const fmt = (c: Command) => `  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} — ${c.description}`
      const parts = [`**${t('helpCommands')}:**`, ...builtin.map(fmt)]
      if (skills.length) parts.push('', `**${t('helpSkills')}:**`, ...skills.map(fmt))
      return { type: 'text', value: parts.join('\n') }
    }),
  ]
}

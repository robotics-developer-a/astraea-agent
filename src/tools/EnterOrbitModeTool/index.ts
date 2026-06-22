// EnterOrbitModeTool — 进入只读规划模式
// 调用即激活 orbit 模式：文件写操作被 query.ts 层拦截
// 模型应在探索代码库、设计方案时调用此工具
import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { setMode, getMode } from '../../state/sessionMode.js'

export const EnterOrbitModeTool = buildTool({
  name: 'EnterOrbitMode',
  description: `Enter orbit mode: a read-only planning phase where file writes are blocked.

Call this tool ONLY when the user wants you to IMPLEMENT changes on a non-trivial task and
you want to explore the codebase and design a plan BEFORE editing files.

Do NOT enter orbit mode for read-only work. If the user is asking a question, requesting an
explanation, asking you to investigate / review / "check whether X", or otherwise only wants
an answer (not file changes), just do the research and answer directly — entering orbit mode
there is a mistake (it forces a needless plan-approval round-trip).

In orbit mode:
- Read, Glob, Grep, Bash (read-only commands) — allowed
- Write, Edit, Bash (write commands) — blocked with an error
- When your plan is ready, call ExitOrbitMode with your complete plan text

Do NOT call this if you are already in orbit mode.`,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },

  async call(_input, _ctx: ToolContext): Promise<ToolCallResult> {
    const current = getMode()
    if (current === 'orbit') {
      return { output: 'Already in orbit mode. Explore and plan, then call ExitOrbitMode when ready.' }
    }
    setMode('orbit')
    return {
      output: [
        'Orbit mode activated.',
        '',
        'File writes are now blocked. You may freely:',
        '  - Read files (Read tool)',
        '  - Search (Glob, Grep)',
        '  - Run read-only Bash commands',
        '',
        'When your plan is complete, call ExitOrbitMode({ plan: "<full plan text>" }).',
      ].join('\n'),
    }
  },
})

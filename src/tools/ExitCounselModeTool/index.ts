// ExitCounselModeTool — 退出 counsel（只读咨询）模式，请求用户授权后切入 cruise 执行
// 执行流程：
//   1. 校验当前确为 counsel 模式
//   2. 通过 AskUserQuestion bridge 把「已确认的方案摘要」展示给用户并请求授权
//   3. 用户批准（allow this session）→ setMode('cruise')，文件写自动通过、shell 仍确认
//   4. 用户拒绝 → 保持 counsel 只读，模型继续咨询
//
// 设计取向：counsel 与 orbit 一样在框架层硬拦截一切写/执行工具（query.ts）。counsel 唯一
// 的逃生口就是本工具——模型「意识到该动手了」时显式请求切模式，由用户授权后才放开执行权。
import { buildTool } from '../Tool.js'
import type { ToolCallResult, ToolContext } from '../Tool.js'
import { setMode, getMode } from '../../state/sessionMode.js'
import { ask } from '../AskUserQuestionTool/bridge.js'

export const ExitCounselModeTool = buildTool({
  name: 'ExitCounselMode',
  description: `Exit counsel mode by asking the user for permission to start executing.

Counsel mode is strictly READ-ONLY (like orbit): every write/execute tool (Edit, Write,
Bash, etc.) is blocked at the framework layer. Reading, searching and AskUserQuestion are
allowed. This is the ONLY way to gain execution permission.

Call this tool ONLY after you have interviewed the user (AskUserQuestion) and the direction
is unambiguous. It will:
1. Show the user a short summary of the agreed approach
2. Ask the user to allow execution for this session
3. If allowed: Astraea switches to CRUISE mode (file writes auto-approved, shell still
   confirmed) and you may begin implementation
4. If declined: you stay in counsel mode (read-only) and should keep consulting

The summary parameter must be a brief markdown recap of what you will do if allowed —
2–4 bullets covering scope, the concrete steps, and how you will verify.`,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief markdown recap (2–4 bullets) of the agreed approach you will execute',
      },
    },
    required: ['summary'],
  },

  async call(input, _ctx: ToolContext): Promise<ToolCallResult> {
    if (getMode() !== 'counsel') {
      return {
        output: 'ExitCounselMode can only be called when in counsel mode.',
        isError: true,
      }
    }

    const summary = input['summary'] as string
    if (!summary?.trim()) {
      return { output: 'summary is required and must not be empty.', isError: true }
    }

    // 向用户展示方案摘要 + 授权请求。summary 通过 planBody 落成持久化 markdown 历史条目，
    // 即便面板被 ESC 关掉也不丢；面板本身只留精简的是/否提示。
    const answer = await ask([{
      header: 'Execute',
      question: 'Approach confirmed. Allow Astraea to start executing in this session? This switches to cruise mode (file writes auto-approved, shell commands still confirmed).',
      options: [
        { label: 'yes — allow this session & switch to cruise' },
        { label: 'no — keep consulting' },
      ],
      planBody: summary,
    }])

    // 只匹配 "→ " 之后的实选项，避免对整串子串匹配（问题正文本身含 "Allow"）。
    const picked = (answer.split('→').pop() ?? answer).trim().toLowerCase()
    // 空答复（无 UI 监听的非交互模式）保持 counsel 闭合，避免无人授权却自行提权。
    const allowed = picked.startsWith('yes') || picked.startsWith('y —') || picked === '1' || picked.includes('switch to cruise')

    if (allowed) {
      setMode('cruise')
      return {
        output: [
          'Execution allowed. Counsel mode exited — switched to CRUISE mode.',
          'File writes are now auto-approved; shell commands are still confirmed per command.',
          '',
          'Proceed with implementation as agreed.',
        ].join('\n'),
      }
    }

    return {
      output: [
        'Execution declined. Still in counsel mode (read-only).',
        'Keep consulting the user with AskUserQuestion, then call ExitCounselMode again when ready.',
      ].join('\n'),
      isError: false,
    }
  },
})

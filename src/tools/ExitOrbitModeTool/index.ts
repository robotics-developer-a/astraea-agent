// ExitOrbitModeTool — 提交规划、请求用户审批、恢复执行权限
// 执行流程：
//   1. 计划文本写入 ~/.astraea/plans/<slug>.md
//   2. 通过 AskUserQuestion bridge 向用户弹出审批
//   3. 用户批准 → restorePreMode()，返回完整计划文本给模型
//   4. 用户拒绝 → 保持 orbit 模式，返回拒绝消息
import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult, ToolContext } from '../Tool.js'
import { restorePreMode, getMode } from '../../state/sessionMode.js'
import { getPlanFilePath, getPlanSlug } from '../../utils/planSlug.js'
import { ask } from '../AskUserQuestionTool/bridge.js'
import { writeFileSync } from 'node:fs'

export const ExitOrbitModeTool = buildTool({
  name: 'ExitOrbitMode',
  description: `Exit orbit mode by presenting your complete plan for user approval.

Call this tool when you have finished exploring and are ready to present your plan.

The plan will be:
1. Written to ~/.astraea/plans/<slug>.md for audit trail
2. Presented to the user for approval (rendered as markdown)
3. If approved: file write permissions are restored and you can begin implementation
4. If rejected: you remain in orbit mode to revise the plan

The plan parameter must be a complete, structured implementation plan in markdown.
It MUST tell the user exactly what you will do, using these sections:
- Context — why this change is needed (1–3 sentences)
- Steps to execute — an explicit, ordered list of the concrete actions you will take
- Files to change — the files you will create or modify
- Verification — how the change will be checked (tests / manual run)

Be concrete: the user should be able to read "Steps to execute" and know precisely
what happens if they approve.`,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  inputSchema: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description: 'Your complete implementation plan in markdown format',
      },
    },
    required: ['plan'],
  },

  async call(input, _ctx: ToolContext): Promise<ToolCallResult> {
    if (getMode() !== 'orbit') {
      return {
        output: 'ExitOrbitMode can only be called when in orbit mode.',
        isError: true,
      }
    }

    const plan = input['plan'] as string
    if (!plan?.trim()) {
      return { output: 'plan is required and must not be empty.', isError: true }
    }

    // ── 1. 写计划文件 ─────────────────────────────────────────────────────
    const planPath = getPlanFilePath()
    const slug = getPlanSlug()
    try {
      writeFileSync(planPath, plan, 'utf-8')
    } catch (err) {
      return { output: `Failed to write plan file: ${err}`, isError: true }
    }

    // ── 2. 向用户展示完整计划 + 审批 ──────────────────────────────────────
    // 计划正文通过 planBody 传递：UI 会把它作为一条持久化的 markdown 历史条目落盘
    // （即使审批面板被 ESC 关掉也不会消失），审批面板本身只保留精简的是/否提示。
    const answer = await ask([{
      header: 'Plan',
      question: `Plan ready (saved to ~/.astraea/plans/${slug}.md). Approve and begin implementation?`,
      options: [
        { label: 'yes — approve and execute' },
        { label: 'no — revise the plan' },
      ],
      planBody: plan,
    }])

    // formatAnswers 返回 "[Plan] <question>\n→ <选项 label>"，问题正文本身含 "Approve"，
    // 不能对整串做子串匹配（否则两个选项都会被判为通过）。只看 "→ " 之后的实选项。
    const picked = (answer.split('→').pop() ?? answer).trim().toLowerCase()
    const approved = picked.startsWith('yes') || picked.startsWith('y —') || picked === '1'

    // ── 3. 审批结果处理 ───────────────────────────────────────────────────
    if (approved) {
      restorePreMode()
      return {
        output: [
          'Plan approved. Orbit mode deactivated — file writes restored.',
          '',
          `Plan file: ~/.astraea/plans/${slug}.md`,
          '',
          '--- APPROVED PLAN ---',
          plan,
          '--- END PLAN ---',
          '',
          'Proceed with implementation as planned.',
        ].join('\n'),
      }
    } else {
      return {
        output: [
          'Plan rejected. Still in orbit mode.',
          '',
          'Revise your plan and call ExitOrbitMode again when ready.',
        ].join('\n'),
        isError: false,
      }
    }
  },
})

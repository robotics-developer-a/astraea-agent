// AskUserQuestionTool — 允许模型向用户提问以澄清意图
// 参考 claude-code-main: AskUserQuestionTool
//
// REPL 模式：通过 bridge 暂停 query 循环，等待用户输入
// CLI 模式：无监听者时立即返回（模型自行判断）

import type { Tool, ToolCallResult } from '../Tool.js'
import { ask } from './bridge.js'

export const AskUserQuestionTool: Tool = {
  name: 'AskUserQuestion',
  description: `Ask the user a clarifying question and wait for their answer.

ONLY use when ALL of the following are true:
1. The action is IRREVERSIBLE or HIGH-RISK (deleting data, overwriting critical files, sending messages)
2. You genuinely cannot infer the intent from context
3. Getting it wrong would cause significant harm

Do NOT use for:
- Missing files that should be created (just create them)
- Choosing between implementation approaches (pick the most reasonable one)
- Ambiguous but low-stakes tasks (make your best judgment and proceed)
- Anything you could figure out by reading the codebase

Bias toward action. If unsure between two reasonable approaches, pick one and go.
Ask at most once per task. Never ask about things the user can see you doing.`,
  isReadOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of suggested answers to show the user',
      },
    },
    required: ['question'],
  },

  async call(input, _ctx: import('../Tool.js').ToolContext): Promise<ToolCallResult> {
    const question = input['question'] as string
    const options = input['options'] as string[] | undefined

    const userAnswer = await ask(question, options)

    if (!userAnswer) {
      return {
        output: '[AskUserQuestion] No interactive terminal available. Proceed with best judgment.',
      }
    }

    return { output: userAnswer }
  },
}

// AskUserQuestionTool — 允许模型向用户提问以澄清意图
// 参考 claude-code-main: AskUserQuestion
//
// REPL 模式：通过 bridge 暂停 query 循环，等待用户输入（多问题面板）
// CLI 模式：无监听者时立即返回（模型自行判断）

import { buildTool } from '../Tool.js'
import type { Tool, ToolCallResult } from '../Tool.js'
import { ask } from './bridge.js'
import type { Question, QuestionOption } from './bridge.js'

// 把模型可能传来的多种 option 形态统一成 {label, description}
function normalizeOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(o => {
      if (typeof o === 'string') return { label: o }
      if (o && typeof o === 'object') {
        const obj = o as Record<string, unknown>
        const label = typeof obj['label'] === 'string' ? (obj['label'] as string) : ''
        const description = typeof obj['description'] === 'string' ? (obj['description'] as string) : undefined
        return label ? { label, description } : null
      }
      return null
    })
    .filter((x): x is QuestionOption => x !== null)
}

// 既支持新结构 questions[]，也兜底旧结构 question + options[]
function normalizeQuestions(input: Record<string, unknown>): Question[] {
  const rawQs = input['questions']
  if (Array.isArray(rawQs) && rawQs.length > 0) {
    return rawQs
      .map((q): Question | null => {
        const obj = (q ?? {}) as Record<string, unknown>
        const question = typeof obj['question'] === 'string' ? (obj['question'] as string) : ''
        const header = typeof obj['header'] === 'string' ? (obj['header'] as string) : undefined
        const multiSelect = obj['multiSelect'] === true
        const options = normalizeOptions(obj['options'])
        return question ? { question, header, multiSelect, options } : null
      })
      .filter((x): x is Question => x !== null)
      .slice(0, 4) // 一次最多 4 题
  }
  // 旧结构兜底
  const question = typeof input['question'] === 'string' ? (input['question'] as string) : ''
  if (!question) return []
  return [{ question, options: normalizeOptions(input['options']) }]
}

export const AskUserQuestionTool = buildTool({
  name: 'AskUserQuestion',
  description: `Ask the user one or more clarifying questions and wait for their answer(s).

Pass a \`questions\` array (1–4 related questions). The user sees a single panel and
navigates between questions with ←→, moves options with ↑↓, toggles with Space, and
submits with Enter. Each question has:
  - question:   the prompt text
  - header:     a short category chip (e.g. "Scope", "Approach")
  - multiSelect: true if multiple answers make sense (default single-select)
  - options:    array of { label, description } — at least 2 per question

ALWAYS put the single best / most-recommended option FIRST and append "(推荐)" to its label.

ONLY use this proactively when ALL are true:
1. The action is IRREVERSIBLE or HIGH-RISK
2. You genuinely cannot infer the intent from context
3. Getting it wrong would cause significant harm

Do NOT use for: missing files (just create them), choosing between low-stakes
approaches (pick one), or anything you could learn by reading the codebase.
Bias toward action. (Counsel mode overrides these restrictions — see its instructions.)`,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        description: 'One to four related questions shown in a single panel (navigated with ←→).',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question prompt' },
            header: { type: 'string', description: 'Short category chip, e.g. "Scope"' },
            multiSelect: { type: 'boolean', description: 'Allow selecting multiple options' },
            options: {
              type: 'array',
              minItems: 2,
              description: 'Choices. Put the recommended one FIRST with "(推荐)" in its label.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['label'],
              },
            },
          },
          required: ['question', 'options'],
        },
      },
      // 旧结构兜底（单题）。新代码应使用 questions[]。
      question: { type: 'string', description: 'Legacy single-question form. Prefer questions[].' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Legacy options for the single-question form.',
      },
    },
  },

  async call(input, _ctx: import('../Tool.js').ToolContext): Promise<ToolCallResult> {
    const questions = normalizeQuestions(input as Record<string, unknown>)

    if (questions.length === 0) {
      return { output: '[AskUserQuestion] No valid question provided.' }
    }

    const userAnswer = await ask(questions)

    if (!userAnswer) {
      return {
        output: '[AskUserQuestion] No interactive terminal available (or user skipped). Proceed with best judgment.',
      }
    }

    return { output: userAnswer }
  },
})
